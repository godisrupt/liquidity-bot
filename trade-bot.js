import dotenv from 'dotenv';
import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL, Transaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import axios from 'axios';
import fs from 'fs';
import { identifyKeyFormat } from './key-validator.js';

// Load environment variables
dotenv.config();

// Configuration
const SOLANA_RPC = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_MINT = process.env.TOKEN_MINT || ''; // Token specified in .env
const TRADE_AMOUNT_USD = Number(process.env.TRADE_AMOUNT_USD || 6); // Fixed USD amount for each trade
const TRADE_INTERVAL_MS = Number(process.env.TRADE_INTERVAL || 60000); // 1 minute in milliseconds
const SLIPPAGE_BPS = parseInt(process.env.SLIPPAGE_BPS || '100'); // 1%
const PRIORITY_FEE = parseInt(process.env.PRIORITY_FEE || '2000000');
const JUPITER_API_BASE = 'https://quote-api.jup.ag/v6';
const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const MIN_SOL_BALANCE = Number(process.env.MIN_SOL_BALANCE || 0.02); // Minimum required SOL balance

// Log file
const LOG_FILE = 'trading.log';

// State variables
let isBuying = true; // Start with a buy
let totalTrades = 0;
let successfulTrades = 0;
let failedTrades = 0;
let totalVolumeSOL = 0;
let totalVolumeUSD = 0;
let startTime = new Date();
let solPriceUSD = 0; // Current SOL price in USD
let lastPurchasedTokenAmount = 0; // Amount of tokens purchased in the last buy
let lastTradeAmountUSD = 0; // Track the exact USD amount used in the last trade

// Logger function
function log(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${type.toUpperCase()}] ${message}`;
  
  // Console log with colors
  if (type === 'error') {
    console.error('\x1b[31m%s\x1b[0m', logMessage);
  } else if (type === 'success') {
    console.log('\x1b[32m%s\x1b[0m', logMessage);
  } else if (type === 'warning') {
    console.log('\x1b[33m%s\x1b[0m', logMessage);
  } else {
    console.log(logMessage);
  }
  
  // File log
  fs.appendFileSync(LOG_FILE, logMessage + '\n');
}

// Load wallet with the validation utility
let wallet;
try {
  if (!process.env.WALLET_PRIVATE_KEY) {
    log('Wallet private key not found in .env file', 'error');
    process.exit(1);
  }
  
  const rawKey = process.env.WALLET_PRIVATE_KEY.trim();
  log(`Validating private key format...`);
  
  // Use our validation utility
  const keyResult = identifyKeyFormat(rawKey);
  
  if (!keyResult.isValid) {
    log(`Private key is invalid: ${keyResult.error}`, 'error');
    process.exit(1);
  }
  
  log(`Key format detected: ${keyResult.format}`, 'success');
  log(`Associated public key: ${keyResult.publicKey}`, 'info');
  
  // Get the private key in standardized base58 format
  const standardPrivateKey = keyResult.privateKey;
  const privateKeyBytes = bs58.decode(standardPrivateKey);
  
  wallet = Keypair.fromSecretKey(privateKeyBytes);
  log(`Wallet loaded successfully: ${wallet.publicKey.toString()}`, 'success');
  
} catch (error) {
  log(`Error loading wallet: ${error.message}`, 'error');
  log('IMPORTANT: Make sure the private key in the .env file is correct and in a valid format.', 'error');
  process.exit(1);
}

// Create Solana connection
const connection = new Connection(SOLANA_RPC, 'confirmed');

// Function to get the current SOL price in USD
async function getSolPriceUSD() {
  try {
    const response = await axios.get(`${COINGECKO_API}/simple/price`, {
      params: {
        ids: 'solana',
        vs_currencies: 'usd'
      }
    });
    
    if (response.data && response.data.solana && response.data.solana.usd) {
      solPriceUSD = response.data.solana.usd;
      log(`Current SOL price: $${solPriceUSD}`, 'info');
      return solPriceUSD;
    } else {
      throw new Error('Invalid price data');
    }
  } catch (error) {
    log(`Error retrieving SOL price: ${error.message}`, 'error');
    
    // In case of failure, use default or last known value
    if (solPriceUSD === 0) {
      solPriceUSD = 150; // Approximate default value if no data is available
      log(`Using default SOL price: $${solPriceUSD}`, 'warning');
    } else {
      log(`Using last known SOL price: $${solPriceUSD}`, 'warning');
    }
    return solPriceUSD;
  }
}

// Function to calculate SOL amount equivalent to USD value
async function calculateTradeAmountSOL() {
  const currentSolPrice = await getSolPriceUSD();
  const tradeAmountSOL = TRADE_AMOUNT_USD / currentSolPrice;
  log(`Trade amount: $${TRADE_AMOUNT_USD} = ${tradeAmountSOL.toFixed(5)} SOL`, 'info');
  return tradeAmountSOL;
}

// Function to get token balance
async function getTokenBalance(tokenMint) {
  try {
    // Find the associated token account
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      wallet.publicKey,
      { mint: new PublicKey(tokenMint) }
    );
    
    if (tokenAccounts.value.length === 0) {
      log(`No account found for token ${tokenMint}`, 'warning');
      return 0;
    }
    
    // Take the first account (usually there's only one)
    const tokenAccount = tokenAccounts.value[0];
    const balance = tokenAccount.account.data.parsed.info.tokenAmount.uiAmount;
    
    log(`Balance of token ${tokenMint}: ${balance}`, 'info');
    return balance;
  } catch (error) {
    log(`Error retrieving token balance: ${error.message}`, 'error');
    return 0;
  }
}

// Function to execute a swap with Jupiter v6 API
async function executeSwap(fromMint, toMint, amountUSD, slippageBps = SLIPPAGE_BPS, inputAmount = null, isTokenAmount = false) {
  try {
    // If it's a token amount (for a sale), use this amount directly
    let amountSOL, amountLamports, inputAmountStr;
    
    if (isTokenAmount && inputAmount !== null) {
      // For a token sale, use the token amount directly
      inputAmountStr = Math.floor(inputAmount * 1000000).toString(); // Conversion to minimum units (assuming 6 decimals)
      log(`Using token amount: ${inputAmount} tokens (${inputAmountStr} minimum units)`, 'info');
    } else {
      // For a purchase with SOL, calculate the SOL amount equivalent to the requested USD value
      amountSOL = inputAmount !== null ? inputAmount : await calculateTradeAmountSOL();
      amountLamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);
      inputAmountStr = amountLamports.toString();
    }
    
    const swapType = isBuying ? 'BUY' : 'SELL';
    log(`\n${swapType} tokens...`);
    log(`From: ${fromMint}`);
    log(`To: ${toMint}`);
    
    if (isTokenAmount && inputAmount !== null) {
      log(`Amount: ${inputAmount} tokens`);
    } else {
      log(`Amount: ${amountSOL.toFixed(5)} SOL ${amountUSD ? `($${amountUSD})` : ''}`);
    }
    
    // 1. Get a quote
    log(`Getting quote for ${inputAmountStr} ${isTokenAmount ? 'token units' : 'lamports'}...`);
    
    const quoteResponse = await axios.get(`${JUPITER_API_BASE}/quote`, {
      params: {
        inputMint: fromMint,
        outputMint: toMint,
        amount: inputAmountStr,
        slippageBps: slippageBps.toString()
      }
    });
    
    if (!quoteResponse.data || !quoteResponse.data.outAmount) {
      throw new Error('Invalid quote received');
    }
    
    // Calculate output amount based on token type
    const outputDecimals = toMint === SOL_MINT ? 9 : 6; // SOL has 9 decimals, most tokens have 6 decimals
    const outAmount = quoteResponse.data.outAmount / Math.pow(10, outputDecimals);
    
    log(`Quote received: ${outAmount} ${toMint === SOL_MINT ? 'SOL' : 'tokens'}`);
    
    // Record output amount if it's a purchase
    if (isBuying) {
      lastPurchasedTokenAmount = outAmount;
      log(`Tokens to receive: ${lastPurchasedTokenAmount}`, 'info');
      
      // Store the exact USD amount used for this purchase
      lastTradeAmountUSD = amountUSD || (amountSOL * solPriceUSD);
      log(`USD amount for this purchase: $${lastTradeAmountUSD.toFixed(2)}`, 'info');
    }
    
    // 2. Create a swap transaction
    log('Creating swap transaction...');
    const swapResponse = await axios.post(`${JUPITER_API_BASE}/swap`, {
      quoteResponse: quoteResponse.data,
      userPublicKey: wallet.publicKey.toString(),
      wrapUnwrapSOL: true,
      priorityFee: PRIORITY_FEE
    });
    
    if (!swapResponse.data || !swapResponse.data.swapTransaction) {
      throw new Error('Invalid transaction received');
    }
    
    // 3. Decode and sign the transaction
    log('Decoding and signing transaction...');
    
    // Jupiter v6 transactions are VersionedTransactions
    const serializedTransaction = swapResponse.data.swapTransaction;
    const transactionBuffer = Buffer.from(serializedTransaction, 'base64');
    
    // Decode using VersionedTransaction
    const transaction = VersionedTransaction.deserialize(transactionBuffer);
    
    // Sign with our wallet
    transaction.sign([wallet]);
    
    log('Transaction signed successfully!', 'success');
    
    // 4. Send the transaction
    log(`Sending transaction...`);
    const txid = await connection.sendTransaction(transaction, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3
    });
    
    log(`Transaction sent successfully! ID: ${txid}`, 'success');
    
    // 5. Wait for confirmation
    log('Waiting for confirmation...');
    const confirmation = await connection.confirmTransaction(txid, 'confirmed');
    
    if (confirmation.value.err) {
      throw new Error(`Error during confirmation: ${JSON.stringify(confirmation.value.err)}`);
    }
    
    log(`Transaction confirmed successfully!`, 'success');
    successfulTrades++;
    totalTrades++;
    
    // Calculate volume in SOL for statistics
    let volumeSOL;
    if (isTokenAmount && inputAmount !== null) {
      // If it was a token sale, use the output amount (in SOL)
      volumeSOL = outAmount;
    } else {
      // If it was a purchase with SOL, use the input amount
      volumeSOL = amountSOL;
    }
    
    totalVolumeSOL += volumeSOL;
    
    if (amountUSD) {
      totalVolumeUSD += amountUSD;
    }
    
    // Save transaction details
    const txDetails = {
      timestamp: new Date().toISOString(),
      type: isBuying ? 'BUY' : 'SELL',
      fromMint,
      toMint,
      inputAmount: isTokenAmount && inputAmount !== null ? inputAmount : amountSOL,
      inputType: isTokenAmount ? 'TOKEN' : 'SOL',
      outputAmount: outAmount,
      outputType: toMint === SOL_MINT ? 'SOL' : 'TOKEN',
      amountUSD,
      txid
    };
    
    fs.appendFileSync('transactions.json', JSON.stringify(txDetails) + ',\n');
    
    return true;
  } catch (error) {
    log(`Error during swap: ${error.message}`, 'error');
    if (error.response) {
      log(`Error data: ${JSON.stringify(error.response.data)}`, 'error');
    }
    failedTrades++;
    totalTrades++;
    return false;
  }
}

// Main function to perform a buy/sell cycle
async function performTradeCycle() {
  try {
    // Check SOL balance
    const solBalance = await connection.getBalance(wallet.publicKey) / LAMPORTS_PER_SOL;
    const solBalanceUSD = solBalance * solPriceUSD;
    log(`\nSOL Balance: ${solBalance.toFixed(6)} SOL (≈ $${solBalanceUSD.toFixed(2)})`);
    
    // Check that the balance is sufficient (at least MIN_SOL_BALANCE)
    if (solBalance < MIN_SOL_BALANCE) {
      log(`Insufficient SOL balance to continue. Required minimum: ${MIN_SOL_BALANCE} SOL`, 'error');
      return false;
    }
    
    // Calculate trade amount in SOL based on the TRADE_AMOUNT_USD value
    const tradeAmountSOL = await calculateTradeAmountSOL();
    
    // Adjust transaction amount if necessary for SOL balance
    let adjustedTradeAmountUSD = TRADE_AMOUNT_USD;
    let adjustedTradeAmountSOL = tradeAmountSOL;
    
    // If the balance is low but above the minimum, adjust the amount for buys
    if (isBuying && solBalance < tradeAmountSOL + 0.005) {
      adjustedTradeAmountSOL = solBalance - 0.005; // Keep 0.005 SOL for fees
      adjustedTradeAmountUSD = adjustedTradeAmountSOL * solPriceUSD;
      log(`Adjusting transaction amount: $${adjustedTradeAmountUSD.toFixed(2)} (${adjustedTradeAmountSOL.toFixed(5)} SOL)`, 'warning');
    }
    
    if (isBuying) {
      // Buy: SOL -> TOKEN
      log('\n--- BUY: SOL -> Token ---');
      log(`Trade amount: $${adjustedTradeAmountUSD.toFixed(2)} (${adjustedTradeAmountSOL.toFixed(5)} SOL)`, 'info');
      await executeSwap(SOL_MINT, TOKEN_MINT, adjustedTradeAmountUSD, SLIPPAGE_BPS, adjustedTradeAmountSOL, false);
    } else {
      // Sell: TOKEN -> SOL
      // Check current token balance
      const tokenBalance = await getTokenBalance(TOKEN_MINT);
      
      // If we don't have tokens
      if (tokenBalance <= 0) {
        log(`No tokens available for sale. Switching to buy.`, 'warning');
        isBuying = true;
        return false;
      }
      
      // Use the exact same USD amount that was used for the last purchase
      let sellAmountUSD = lastTradeAmountUSD > 0 ? lastTradeAmountUSD : adjustedTradeAmountUSD;
      
      // Determine the equivalent token amount to sell based on the saved USD value
      log('\n--- SELL: Token -> SOL ---');
      log(`Target sell amount: $${sellAmountUSD.toFixed(2)} (exact same amount as last purchase)`, 'info');
      
      // Get a quote to determine current token price (1 token = X SOL)
      try {
        // Get token to SOL exchange rate for a single token
        const singleTokenInMinUnits = "1000000"; // 1 token in minimum units (assuming 6 decimals)
        const priceQuote = await axios.get(`${JUPITER_API_BASE}/quote`, {
          params: {
            inputMint: TOKEN_MINT,
            outputMint: SOL_MINT,
            amount: singleTokenInMinUnits,
            slippageBps: SLIPPAGE_BPS.toString()
          }
        });
        
        // Calculate SOL per token
        const solPerToken = priceQuote.data.outAmount / LAMPORTS_PER_SOL;
        
        // Calculate token value in USD
        const tokenValueUSD = solPerToken * solPriceUSD;
        
        // Calculate how many tokens to sell to equal the saved USD amount
        const tokensToSell = sellAmountUSD / tokenValueUSD;
        
        log(`Current token value: 1 token = ${solPerToken.toFixed(8)} SOL = $${tokenValueUSD.toFixed(6)}`, 'info');
        log(`Selling ${tokensToSell.toFixed(6)} tokens to get ~$${sellAmountUSD.toFixed(2)}`, 'info');
        
        // Check if we have enough tokens
        if (tokenBalance < tokensToSell) {
          log(`Insufficient token balance. Available: ${tokenBalance}, Required: ${tokensToSell}`, 'warning');
          // Sell what we have
          log(`Selling available balance: ${tokenBalance} tokens`, 'warning');
          await executeSwap(TOKEN_MINT, SOL_MINT, null, SLIPPAGE_BPS, tokenBalance, true);
        } else {
          // Sell the planned amount
          await executeSwap(TOKEN_MINT, SOL_MINT, null, SLIPPAGE_BPS, tokensToSell, true);
        }
      } catch (error) {
        log(`Error getting token price: ${error.message}`, 'error');
        // Fallback: use lastPurchasedTokenAmount if available
        if (lastPurchasedTokenAmount > 0) {
          log(`Fallback: Using last purchased amount for reference`, 'warning');
          await executeSwap(TOKEN_MINT, SOL_MINT, null, SLIPPAGE_BPS, Math.min(lastPurchasedTokenAmount, tokenBalance), true);
        } else {
          log(`Cannot determine appropriate amount to sell, switching to buy`, 'error');
          isBuying = true;
          return false;
        }
      }
    }
    
    // Alternate between buy and sell
    isBuying = !isBuying;
    
    // Statistics
    const runTime = Math.floor((new Date() - startTime) / 1000); // in seconds
    const hours = Math.floor(runTime / 3600);
    const minutes = Math.floor((runTime % 3600) / 60);
    const seconds = runTime % 60;
    const runTimeFormatted = `${hours}h ${minutes}m ${seconds}s`;
    
    log('\n--- STATISTICS ---');
    log(`Total transactions: ${totalTrades}`);
    log(`Successful: ${successfulTrades}`);
    log(`Failed: ${failedTrades}`);
    log(`Total volume: ${totalVolumeSOL.toFixed(6)} SOL (≈ $${totalVolumeUSD.toFixed(2)})`);
    log(`Run time: ${runTimeFormatted}`);
    log(`Next action: ${isBuying ? 'BUY' : 'SELL'}`);
    
    return true;
  } catch (error) {
    log(`Error during trading cycle: ${error.message}`, 'error');
    return false;
  }
}

// Start the bot
async function startBot() {
  // Create transactions file if it doesn't exist
  if (!fs.existsSync('transactions.json')) {
    fs.writeFileSync('transactions.json', '[\n');
  }
  
  // Get initial SOL price
  await getSolPriceUSD();
  
  log('\n=== SOLANA TOKEN VOLUME TRADING BOT STARTED ===', 'success');
  log(`Wallet: ${wallet.publicKey.toString()}`);
  log(`Token: ${TOKEN_MINT}`);
  log(`Amount per transaction: $${TRADE_AMOUNT_USD} (≈ ${(TRADE_AMOUNT_USD / solPriceUSD).toFixed(5)} SOL)`);
  log(`Minimum required balance: ${MIN_SOL_BALANCE} SOL`);
  log(`Interval: ${TRADE_INTERVAL_MS / 1000} seconds`);
  log('---------------------------------------------');
  
  // Test RPC connection
  try {
    const version = await connection.getVersion();
    log(`RPC connection established: ${SOLANA_RPC}`);
    log(`Version: ${version["solana-core"]}`);
  } catch (error) {
    log(`RPC connection error: ${error.message}`, 'error');
    process.exit(1);
  }
  
  // Initial execution
  await performTradeCycle();
  
  // Set up interval
  const intervalId = setInterval(async () => {
    // Update SOL price every 10 transactions
    if (totalTrades % 10 === 0) {
      await getSolPriceUSD();
    }
    
    const success = await performTradeCycle();
    if (!success) {
      log('Problem detected, bot continues but watch for errors.', 'warning');
    }
  }, TRADE_INTERVAL_MS);
  
  // Handle clean shutdown
  process.on('SIGINT', () => {
    log('\nStopping bot...', 'warning');
    clearInterval(intervalId);
    
    // Close transactions file
    fs.appendFileSync('transactions.json', '{}]\n');
    
    log('Bot stopped.', 'warning');
    process.exit(0);
  });
}

// Launch the bot
startBot().catch(error => {
  log(`Fatal error: ${error.message}`, 'error');
  process.exit(1);
}); 
