# 🤖 Solana Trading Bot

> An automated volume trading bot for Solana tokens using Jupiter Exchange.
> 
> Created by [@go_disrupt](https://twitter.com/go_disrupt)

## ✨ Features

- 🔄 **Automated Trading**: Set it up and let it work for you
- ⚙️ **Highly Configurable**: Customize trade amounts, intervals, and more
- ⚖️ **Smart Volume Trading**: Balanced buy/sell operations for token volume
- 📊 **Detailed Analytics**: Transaction logs and performance statistics
- 🔐 **Security First**: Secure wallet key management

## 🚀 Quick Start

### 📋 Prerequisites

- Node.js (v16+)
- NPM or Yarn
- A Solana wallet with SOL to cover transaction fees

### 💻 Installation

1. **Clone this repository**
   ```bash
   git clone https://github.com/yourusername/solana-volume-trading-bot.git
   cd solana-volume-trading-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up your environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

## 🔑 Private Key Management

The bot requires a Solana private key in base58 format. Two utility scripts make this easy:

### 🆕 Option 1: Generate a New Wallet

```bash
# Using npm
npm run generate-wallet

# OR directly
node generate-wallet.js
```

This will:
1. ✨ Generate a new Solana keypair
2. 🔄 Convert the private key to base58 format
3. 📝 Display the information in the terminal
4. 💾 Save the information to `wallet-info.json`

Add the generated base58 private key to your `.env` file:

```
WALLET_PRIVATE_KEY=your_generated_base58_private_key
```

> ⚠️ **Important**: Make sure this wallet has enough SOL to cover transaction fees.

### 🔄 Option 2: Convert an Existing Key

If you already have a Solana private key in another format (array, hex, base64):

```bash
# Using npm
npm run convert-key "your-existing-private-key"

# OR directly
node convert-key.js "your-existing-private-key"
```

This will:
1. 🔍 Automatically detect your key's format
2. 🔄 Convert it to the required base58 format
3. 📝 Display the information in the terminal

### 🗝️ Supported Key Formats

- **Base58** (Solana standard): base58-encoded string
- **Array**: Array of 64 integers separated by commas
- **Hex**: 128-character hexadecimal string
- **Base64**: base64-encoded string

## ⚙️ Configuration

Create a `.env` file with the following parameters:

```
# Required parameters
TOKEN_MINT=your_token_mint_address
WALLET_PRIVATE_KEY=your_wallet_private_key

# Trading parameters (with defaults)
TRADE_AMOUNT_USD=16
TRADE_INTERVAL=60000
SLIPPAGE_BPS=100
PRIORITY_FEE=2000000

# Solana configuration
RPC_ENDPOINT=https://api.mainnet-beta.solana.com
```

### 🔑 Important Parameters:

- `TOKEN_MINT`: The token mint address you want to trade (required)
- `WALLET_PRIVATE_KEY`: Your wallet's private key (required, base58 format)
- `TRADE_AMOUNT_USD`: Amount in USD for each trade cycle (default: $16)
- `TRADE_INTERVAL`: Interval between trades in milliseconds (default: 60000 = 1 minute)

## 🏃‍♂️ Usage

Start the bot:

```bash
# Using npm
npm start

# OR directly
node trade-bot.js
```

The bot will:
1. 🛒 Start by buying the specified token
2. ⏱️ Wait for the configured interval
3. 💰 Sell the same amount of tokens it bought
4. 🔁 Repeat the cycle

## 📊 Monitoring

- Transaction logs are stored in `trading.log`
- Transaction details are stored in `transactions.json`

View live logs:

```bash
tail -f trading.log
```

## 🛡️ Safety Features

- Minimum SOL balance check (0.02 SOL)
- Automatic adjustment of trade amounts if balance is low
- Comprehensive error handling
- Proper transaction confirmation checks

## 🛑 Stopping the Bot

Press `Ctrl+C` in the terminal where the bot is running, or use:

```bash
killall -9 node
```

## ⭐ Star the Project

If you find this bot useful, please consider giving it a star on GitHub!

## 🔗 Let's Connect

Follow me on X: [@go_disrupt](https://twitter.com/go_disrupt)

## ⚠️ Disclaimer

This software is provided for educational and demonstration purposes only. Trading cryptocurrencies involves significant risk. Use at your own risk. 