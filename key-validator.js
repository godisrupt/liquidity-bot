import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

/**
 * Utility to validate a private key in different formats.
 * Can be used to test and identify the correct format of a private key.
 */

// Known key formats
const FORMATS = {
  BASE58: 'base58',
  BASE64: 'base64',
  HEX: 'hex',
  ARRAY: 'array',
  UNKNOWN: 'unknown'
};

/**
 * Attempts to validate and identify the format of a private key
 * @param {string} key - The private key in string format
 * @returns {Object} Result including the identified format and publicKey if successful
 */
export function identifyKeyFormat(key) {
  // Clean the key
  key = key.trim();
  
  // Default result
  let result = {
    isValid: false,
    format: FORMATS.UNKNOWN,
    publicKey: null,
    error: null
  };
  
  // Array of attempts to try
  const attempts = [
    // Base58 (standard Solana format)
    () => {
      const decodedKey = bs58.decode(key);
      if (decodedKey.length === 64) {
        const keypair = Keypair.fromSecretKey(decodedKey);
        return {
          isValid: true,
          format: FORMATS.BASE58,
          publicKey: keypair.publicKey.toString(),
          privateKey: bs58.encode(keypair.secretKey)
        };
      }
      throw new Error("Decoded key is not 64 bytes");
    },
    
    // Base64
    () => {
      const decodedKey = Buffer.from(key, 'base64');
      if (decodedKey.length === 64) {
        const keypair = Keypair.fromSecretKey(decodedKey);
        return {
          isValid: true,
          format: FORMATS.BASE64,
          publicKey: keypair.publicKey.toString(),
          privateKey: bs58.encode(keypair.secretKey)
        };
      }
      throw new Error("Decoded key is not 64 bytes");
    },
    
    // Hex
    () => {
      // Check if it's a valid hexadecimal string
      if (!/^[0-9a-fA-F]+$/.test(key)) throw new Error("Invalid hex format");
      
      const decodedKey = Buffer.from(key, 'hex');
      if (decodedKey.length === 64) {
        const keypair = Keypair.fromSecretKey(decodedKey);
        return {
          isValid: true,
          format: FORMATS.HEX,
          publicKey: keypair.publicKey.toString(),
          privateKey: bs58.encode(keypair.secretKey)
        };
      }
      throw new Error("Decoded key is not 64 bytes");
    },
    
    // Array of numbers (comma separated)
    () => {
      const numbers = key.split(',').map(num => parseInt(num.trim(), 10));
      if (numbers.length === 64 && !numbers.some(isNaN)) {
        const arrayBuffer = Uint8Array.from(numbers);
        const keypair = Keypair.fromSecretKey(arrayBuffer);
        return {
          isValid: true,
          format: FORMATS.ARRAY,
          publicKey: keypair.publicKey.toString(),
          privateKey: bs58.encode(keypair.secretKey)
        };
      }
      throw new Error("Invalid array format or incorrect length");
    }
  ];
  
  // Try each format
  for (const attempt of attempts) {
    try {
      const testResult = attempt();
      if (testResult.isValid) {
        return testResult;
      }
    } catch (e) {
      // Continue with the next format
    }
  }
  
  // If we get here, no format worked
  result.error = "Unable to decode private key in any known format";
  return result;
}

// Example usage
if (process.argv.length > 2) {
  const keyToTest = process.argv[2];
  console.log("Testing provided key...");
  const result = identifyKeyFormat(keyToTest);
  console.log(JSON.stringify(result, null, 2));
} 