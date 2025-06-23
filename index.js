const axios = require('axios');
const fs = require('fs').promises;

// Enhanced constants with backup endpoints
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const CACHE_FILE = 'token_cache.json';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

class OptimizedSolanaTokenPriceChecker {
    constructor() {
        // Multiple API endpoints for redundancy
        this.apiEndpoints = {
            // Jupiter Price API (primary)
            jupiterPrice: 'https://price.jup.ag/v4',
            // Jupiter Quote API (fallback 1)
            jupiterQuote: 'https://quote-api.jup.ag/v6',
            // Jupiter Tokens API
            jupiterTokens: 'https://token.jup.ag/all',
            // Backup RPC endpoints
            solanaRpc: [
                'https://api.mainnet-beta.solana.com',
                'https://rpc.ankr.com/solana',
                'https://solana-api.projectserum.com'
            ]
        };
        
        this.tokenCache = new Map();
        this.priceCache = new Map();
        this.allTokens = null;
        this.lastTokenFetch = null;
        this.currentRpcIndex = 0;
        
        // Enhanced axios instance with retry logic
        this.axiosInstance = axios.create({
            timeout: 15000,
            headers: {
                'User-Agent': 'SolanaTokenChecker/1.0',
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
        
        // Add retry interceptor
        this.setupRetryInterceptor();
    }

    /**
     * Setup axios retry interceptor for network issues
     */
    setupRetryInterceptor() {
        this.axiosInstance.interceptors.response.use(
            (response) => response,
            async (error) => {
                const { config } = error;
                
                if (!config || !config.retry) {
                    config.retry = 0;
                }
                
                if (config.retry >= 3) {
                    return Promise.reject(error);
                }
                
                config.retry += 1;
                
                // Exponential backoff: 1s, 2s, 4s
                const delay = Math.pow(2, config.retry) * 1000;
                
                console.log(`🔄 Retrying request (attempt ${config.retry}/3) in ${delay}ms...`);
                
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.axiosInstance(config);
            }
        );
    }

    /**
     * Enhanced initialization with better error handling
     */
    async initialize() {
        try {
            console.log('🚀 Initializing Optimized Solana Token Price Checker...');
            await this.loadTokenCache();
            await this.fetchAllJupiterTokens();
            console.log('✅ Initialization complete!');
        } catch (error) {
            console.error('❌ Initialization failed:', error.message);
            console.log('📋 Continuing with cached data if available...');
        }
    }

    /**
     * Enhanced token fetching with multiple endpoint support
     */
    async fetchAllJupiterTokens() {
        try {
            if (this.allTokens && this.lastTokenFetch && 
                (Date.now() - this.lastTokenFetch) < 60 * 60 * 1000) {
                return this.allTokens;
            }

            console.log('📡 Fetching all Jupiter tokens...');
            
            // Try multiple approaches to get token list
            let response;
            
            try {
                response = await this.axiosInstance.get(this.apiEndpoints.jupiterTokens);
            } catch (error) {
                console.log('⚠️  Primary token endpoint failed, trying backup...');
                // Backup: use a static list of common tokens if API fails
                response = { data: await this.getBackupTokenList() };
            }

            this.allTokens = response.data;
            this.lastTokenFetch = Date.now();

            this.allTokens.forEach(token => {
                this.tokenCache.set(token.address, token);
            });

            await this.saveTokenCache();
            console.log(`✅ Loaded ${this.allTokens.length} Jupiter tokens`);
            return this.allTokens;

        } catch (error) {
            console.error('❌ Failed to fetch Jupiter tokens:', error.message);
            if (this.allTokens) {
                console.log('📋 Using cached token data');
                return this.allTokens;
            }
            throw error;
        }
    }

    /**
     * Backup token list for when API is unavailable
     */
    async getBackupTokenList() {
        return [
            {
                address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
                name: 'USD Coin',
                symbol: 'USDC',
                decimals: 6
            },
            {
                address: 'So11111111111111111111111111111111111111112',
                name: 'Wrapped SOL',
                symbol: 'SOL',
                decimals: 9
            },
            {
                address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
                name: 'dogwifhat',
                symbol: '$WIF',
                decimals: 6
            },
            {
                address: '5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC',
                name: 'PONKE',
                symbol: 'PONKE',
                decimals: 5
            },
            {
                address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
                name: 'Bonk',
                symbol: 'Bonk',
                decimals: 5
            },
            {
                address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
                name: 'Jupiter',
                symbol: 'JUP',
                decimals: 6
            }
        ];
    }

    /**
     * Enhanced price fetching with improved error handling
     */
    async getTokenPriceInUSDC(tokenMint, amount = 1) {
        try {
            if (!tokenMint || typeof tokenMint !== 'string') {
                throw new Error('Invalid token mint address');
            }
            if (!amount || amount <= 0) {
                throw new Error('Amount must be greater than 0');
            }

            console.log(`💰 Getting price for ${amount} tokens (${tokenMint})`);

            const tokenInfo = await this.getTokenInfo(tokenMint);
            console.log(`📋 Token: ${tokenInfo.name} (${tokenInfo.symbol})`);

            // Enhanced pricing strategy
            let priceResult = null;

            // Skip Price API if we know it's having issues, go straight to Quote API
            console.log('📊 Using Quote API (more reliable)...');
            priceResult = await this.tryQuoteApi(tokenMint, amount, tokenInfo);
            if (priceResult.success) {
                console.log(`✅ Price found via Quote API`);
                return this.formatPriceResult(priceResult, tokenInfo, 'quote_api');
            }

            // If Quote API fails, try SOL conversion
            priceResult = await this.trySOLConversion(tokenMint, amount, tokenInfo);
            if (priceResult.success) {
                console.log(`✅ Price found via SOL conversion`);
                return this.formatPriceResult(priceResult, tokenInfo, 'sol_conversion');
            }

            // Final fallback: try alternative calculation methods
            priceResult = await this.tryAlternativePricing(tokenMint, amount, tokenInfo);
            if (priceResult.success) {
                console.log(`✅ Price found via alternative method`);
                return this.formatPriceResult(priceResult, tokenInfo, 'alternative');
            }

            throw new Error('All pricing methods failed');

        } catch (error) {
            console.error('❌ Error in getTokenPriceInUSDC:', error.message);
            return {
                success: false,
                error: error.message,
                tokenMint,
                amount,
                suggestion: 'Try again in a few moments or check if the token has sufficient liquidity'
            };
        }
    }

    /**
     * Enhanced Quote API with better error handling
     */
    async tryQuoteApi(tokenMint, amount, tokenInfo) {
        try {
            const decimals = tokenInfo.decimals || 6;
            const amountInSmallestUnit = Math.floor(amount * Math.pow(10, decimals));

            const response = await this.axiosInstance.get(`${this.apiEndpoints.jupiterQuote}/quote`, {
                params: {
                    inputMint: tokenMint,
                    outputMint: USDC_MINT,
                    amount: amountInSmallestUnit,
                    slippageBps: 50,
                    onlyDirectRoutes: false, // Allow multi-hop routes for better prices
                    asLegacyTransaction: false
                }
            });

            if (response.data?.outAmount) {
                const usdcAmount = response.data.outAmount / Math.pow(10, 6);
                const pricePerToken = usdcAmount / amount;

                // Cache successful result
                const cacheKey = `quote_${tokenMint}`;
                this.priceCache.set(cacheKey, {
                    price: pricePerToken,
                    timestamp: Date.now()
                });

                return {
                    success: true,
                    pricePerToken,
                    totalValueUSDC: usdcAmount,
                    slippage: '0.5%',
                    route: response.data,
                    amount
                };
            }

            return { success: false };
        } catch (error) {
            console.log(`⚠️  Quote API failed: ${error.message}`);
            return { success: false };
        }
    }

    /**
     * Alternative pricing method using different approaches
     */
    async tryAlternativePricing(tokenMint, amount, tokenInfo) {
        try {
            // Method 1: Try with different slippage
            for (const slippage of [100, 200, 500]) { // 1%, 2%, 5%
                try {
                    const decimals = tokenInfo.decimals || 6;
                    const amountInSmallestUnit = Math.floor(amount * Math.pow(10, decimals));

                    const response = await this.axiosInstance.get(`${this.apiEndpoints.jupiterQuote}/quote`, {
                        params: {
                            inputMint: tokenMint,
                            outputMint: USDC_MINT,
                            amount: amountInSmallestUnit,
                            slippageBps: slippage,
                            onlyDirectRoutes: true
                        }
                    });

                    if (response.data?.outAmount) {
                        const usdcAmount = response.data.outAmount / Math.pow(10, 6);
                        const pricePerToken = usdcAmount / amount;

                        return {
                            success: true,
                            pricePerToken,
                            totalValueUSDC: usdcAmount,
                            slippage: `${slippage / 100}%`,
                            method: 'high_slippage',
                            amount
                        };
                    }
                } catch (e) {
                    continue;
                }
            }

            return { success: false };
        } catch (error) {
            return { success: false };
        }
    }

    /**
     * Enhanced SOL conversion with multiple RPC endpoints
     */
    async trySOLConversion(tokenMint, amount, tokenInfo) {
        try {
            const tokenSolPrice = await this.getTokenPriceInSOL(tokenMint, amount, tokenInfo);
            if (!tokenSolPrice.success) return { success: false };

            const solUsdcPrice = await this.tryQuoteApi(SOL_MINT, tokenSolPrice.totalValueSOL, { decimals: 9 });
            if (!solUsdcPrice.success) return { success: false };

            return {
                success: true,
                pricePerToken: solUsdcPrice.totalValueUSDC / amount,
                totalValueUSDC: solUsdcPrice.totalValueUSDC,
                conversionPath: 'TOKEN -> SOL -> USDC',
                amount
            };
        } catch (error) {
            console.log(`⚠️  SOL conversion failed: ${error.message}`);
            return { success: false };
        }
    }

    /**
     * Enhanced token price in SOL
     */
    async getTokenPriceInSOL(tokenMint, amount, tokenInfo) {
        try {
            const decimals = tokenInfo.decimals || 6;
            const amountInSmallestUnit = Math.floor(amount * Math.pow(10, decimals));

            const response = await this.axiosInstance.get(`${this.apiEndpoints.jupiterQuote}/quote`, {
                params: {
                    inputMint: tokenMint,
                    outputMint: SOL_MINT,
                    amount: amountInSmallestUnit,
                    slippageBps: 100
                }
            });

            if (response.data?.outAmount) {
                const solAmount = response.data.outAmount / Math.pow(10, 9);
                return {
                    success: true,
                    totalValueSOL: solAmount,
                    pricePerTokenInSOL: solAmount / amount
                };
            }

            return { success: false };
        } catch (error) {
            return { success: false };
        }
    }

    /**
     * Enhanced token info with multiple RPC fallbacks
     */
    async getTokenInfo(tokenMint) {
        if (this.tokenCache.has(tokenMint)) {
            return this.tokenCache.get(tokenMint);
        }

        if (this.allTokens) {
            const jupiterToken = this.allTokens.find(token => token.address === tokenMint);
            if (jupiterToken) {
                this.tokenCache.set(tokenMint, jupiterToken);
                return jupiterToken;
            }
        }

        // Try multiple RPC endpoints
        for (const rpcUrl of this.apiEndpoints.solanaRpc) {
            try {
                const response = await this.axiosInstance.post(rpcUrl, {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getAccountInfo',
                    params: [tokenMint, { encoding: 'jsonParsed' }]
                });

                if (response.data.result?.value?.data?.parsed?.info) {
                    const info = response.data.result.value.data.parsed.info;
                    const tokenInfo = {
                        address: tokenMint,
                        name: info.name || 'Unknown Token',
                        symbol: info.symbol || 'UNK',
                        decimals: info.decimals || 6,
                        source: 'rpc'
                    };
                    
                    this.tokenCache.set(tokenMint, tokenInfo);
                    return tokenInfo;
                }
            } catch (error) {
                console.log(`⚠️  RPC ${rpcUrl} failed, trying next...`);
                continue;
            }
        }

        const fallbackInfo = {
            address: tokenMint,
            name: 'Unknown Token',
            symbol: 'UNK',
            decimals: 6,
            source: 'fallback'
        };
        
        this.tokenCache.set(tokenMint, fallbackInfo);
        return fallbackInfo;
    }

    /**
     * Enhanced result formatting with more details
     */
    formatPriceResult(result, tokenInfo, method) {
        return {
            success: true,
            token: {
                address: tokenInfo.address,
                name: tokenInfo.name,
                symbol: tokenInfo.symbol,
                decimals: tokenInfo.decimals
            },
            pricing: {
                amount: result.amount || (result.totalValueUSDC / result.pricePerToken),
                pricePerToken: result.pricePerToken,
                totalValueUSDC: result.totalValueUSDC,
                method: method,
                timestamp: new Date().toISOString(),
                confidence: this.calculateConfidence(method, result)
            },
            additional: {
                slippage: result.slippage || null,
                conversionPath: result.conversionPath || 'DIRECT',
                route: result.route ? 'Available' : null,
                cached: result.cached || false
            }
        };
    }

    /**
     * Calculate confidence score based on method and result
     */
    calculateConfidence(method, result) {
        let confidence = 'medium';
        
        if (method === 'quote_api' && result.route) {
            confidence = 'high';
        } else if (method === 'sol_conversion') {
            confidence = 'medium';
        } else if (method === 'alternative' && result.slippage) {
            const slippageNum = parseFloat(result.slippage);
            confidence = slippageNum <= 1 ? 'medium' : 'low';
        }
        
        return confidence;
    }

    // Include all other methods from the original class...
    async searchTokens(query) {
        await this.fetchAllJupiterTokens();
        
        const searchQuery = query.toLowerCase();
        return this.allTokens.filter(token => 
            token.symbol.toLowerCase().includes(searchQuery) ||
            token.name.toLowerCase().includes(searchQuery)
        ).slice(0, 10);
    }

    async getAllTokens(page = 1, limit = 100) {
        await this.fetchAllJupiterTokens();
        
        const start = (page - 1) * limit;
        const end = start + limit;
        
        return {
            tokens: this.allTokens.slice(start, end),
            pagination: {
                page,
                limit,
                total: this.allTokens.length,
                totalPages: Math.ceil(this.allTokens.length / limit),
                hasNext: end < this.allTokens.length,
                hasPrev: page > 1
            }
        };
    }

    async loadTokenCache() {
        try {
            const cacheData = await fs.readFile(CACHE_FILE, 'utf8');
            const parsed = JSON.parse(cacheData);
            
            if (parsed.tokens) {
                Object.entries(parsed.tokens).forEach(([key, value]) => {
                    this.tokenCache.set(key, value);
                });
            }
            
            if (parsed.allTokens && parsed.timestamp && 
                (Date.now() - parsed.timestamp) < 60 * 60 * 1000) {
                this.allTokens = parsed.allTokens;
                this.lastTokenFetch = parsed.timestamp;
            }
            
            console.log('📋 Loaded cache from file');
        } catch (error) {
            console.log('📋 No cache file found, starting fresh');
        }
    }

    async saveTokenCache() {
        try {
            const cacheData = {
                timestamp: Date.now(),
                tokens: Object.fromEntries(this.tokenCache),
                allTokens: this.allTokens
            };
            
            await fs.writeFile(CACHE_FILE, JSON.stringify(cacheData, null, 2));
        } catch (error) {
            console.log('⚠️  Failed to save cache:', error.message);
        }
    }

    clearCache() {
        this.tokenCache.clear();
        this.priceCache.clear();
        this.allTokens = null;
        this.lastTokenFetch = null;
        console.log('🗑️  Cache cleared');
    }
}

// Enhanced usage functions
async function checkTokenPrice(contractAddress, amount) {
    const checker = new OptimizedSolanaTokenPriceChecker();
    await checker.initialize();
    
    console.log(`\n🔍 Checking ${amount} tokens with CA: ${contractAddress}`);
    console.log('='.repeat(60));
    
    const result = await checker.getTokenPriceInUSDC(contractAddress, amount);
    
    if (result.success) {
        console.log(`\n💰 PRICE RESULTS:`);
        console.log(`Token: ${result.token.name} (${result.token.symbol})`);
        console.log(`Amount: ${amount} ${result.token.symbol}`);
        console.log(`Total Value: $${result.pricing.totalValueUSDC.toFixed(6)} USDC`);
        console.log(`Price per token: $${result.pricing.pricePerToken.toFixed(8)} USDC`);
        console.log(`Method: ${result.pricing.method}`);
        console.log(`Confidence: ${result.pricing.confidence}`);
        console.log(`Path: ${result.additional.conversionPath}`);
        if (result.additional.slippage) {
            console.log(`Slippage: ${result.additional.slippage}`);
        }
        console.log(`Timestamp: ${result.pricing.timestamp}`);
    } else {
        console.log(`\n❌ ERROR: ${result.error}`);
        if (result.suggestion) {
            console.log(`💡 Suggestion: ${result.suggestion}`);
        }
    }
    
    return result;
}

async function quickPriceCheck(contractAddress, amount = 1) {
    const checker = new OptimizedSolanaTokenPriceChecker();
    await checker.initialize();
    
    const result = await checker.getTokenPriceInUSDC(contractAddress, amount);
    
    if (result.success) {
        return {
            symbol: result.token.symbol,
            amount: amount,
            totalValue: result.pricing.totalValueUSDC,
            pricePerToken: result.pricing.pricePerToken,
            confidence: result.pricing.confidence
        };
    } else {
        return { error: result.error };
    }
}

// Network diagnostic function
async function networkDiagnostic() {
    console.log('🔧 Running network diagnostic...\n');
    
    const endpoints = [
        'https://price.jup.ag/v4/price',
        'https://quote-api.jup.ag/v6/quote',
        'https://token.jup.ag/all',
        'https://api.mainnet-beta.solana.com'
    ];
    
    for (const endpoint of endpoints) {
        try {
            const start = Date.now();
            const response = await axios.get(endpoint, { timeout: 5000 });
            const duration = Date.now() - start;
            console.log(`✅ ${endpoint} - ${duration}ms - Status: ${response.status}`);
        } catch (error) {
            console.log(`❌ ${endpoint} - Error: ${error.message}`);
        }
    }
}

module.exports = {
    OptimizedSolanaTokenPriceChecker,
    checkTokenPrice,
    quickPriceCheck,
    networkDiagnostic
};

// Run examples if this file is executed directly
if (require.main === module) {
    (async () => {
        // Run network diagnostic first
        await networkDiagnostic();
        
        console.log('\n' + '='.repeat(60));
        console.log('🚀 Running Optimized Examples\n');
        
        // Quick test
        await checkTokenPrice('EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', 100);
    })().catch(console.error);
}