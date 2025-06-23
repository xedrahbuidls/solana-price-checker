const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { OptimizedSolanaTokenPriceChecker } = require('./index'); // Your price checker

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize the price checker
let priceChecker;

// Middleware
app.use(express.json());
app.use(cors());

// Rate limiting
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // limit each IP to 30 requests per windowMs
    message: {
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        resetTime: 60
    }
});

app.use('/api/', limiter);

// Initialize price checker on startup
async function initializeServer() {
    try {
        console.log('🚀 Initializing Solana Price API Server...');
        priceChecker = new OptimizedSolanaTokenPriceChecker();
        await priceChecker.initialize();
        console.log('✅ Price checker initialized successfully');
    } catch (error) {
        console.error('❌ Failed to initialize price checker:', error.message);
        // Continue with limited functionality
        priceChecker = new OptimizedSolanaTokenPriceChecker();
    }
}

// Helper function to validate contract address
function isValidSolanaAddress(address) {
    if (!address || typeof address !== 'string') return false;
    // Basic Solana address validation (base58, 32-44 characters)
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return base58Regex.test(address);
}

// ================================
// API ROUTES
// ================================

// 1. GET Token Price - Main endpoint for Postman testing
app.get('/api/price/:contractAddress', async (req, res) => {
    try {
        const { contractAddress } = req.params;
        const { amount = 1 } = req.query;

        // Validation
        if (!isValidSolanaAddress(contractAddress)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid contract address format',
                message: 'Please provide a valid Solana contract address (32-44 characters, base58)',
                example: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'
            });
        }

        const tokenAmount = parseFloat(amount);
        if (isNaN(tokenAmount) || tokenAmount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid amount',
                message: 'Amount must be a positive number',
                provided: amount
            });
        }

        console.log(`📡 API Request: ${tokenAmount} tokens of ${contractAddress}`);

        // Get token price
        const result = await priceChecker.getTokenPriceInUSDC(contractAddress, tokenAmount);

        if (result.success) {
            res.json({
                success: true,
                data: {
                    token: result.token,
                    pricing: result.pricing,
                    metadata: {
                        requestId: `req_${Date.now()}`,
                        processingTime: '~2-5s',
                        apiVersion: '1.0'
                    }
                },
                additional: result.additional
            });
        } else {
            res.status(404).json({
                success: false,
                error: result.error,
                message: 'Could not fetch token price',
                suggestion: result.suggestion || 'Please verify the contract address and try again',
                contractAddress,
                amount: tokenAmount
            });
        }

    } catch (error) {
        console.error('❌ API Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'An unexpected error occurred while fetching token price',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// 2. POST Token Price - Alternative endpoint for POST requests
app.post('/api/price', async (req, res) => {
    try {
        const { contractAddress, amount = 1 } = req.body;

        if (!contractAddress) {
            return res.status(400).json({
                success: false,
                error: 'Missing contract address',
                message: 'Please provide a contractAddress in the request body'
            });
        }

        if (!isValidSolanaAddress(contractAddress)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid contract address format',
                message: 'Please provide a valid Solana contract address'
            });
        }

        const tokenAmount = parseFloat(amount);
        if (isNaN(tokenAmount) || tokenAmount <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid amount',
                message: 'Amount must be a positive number'
            });
        }

        console.log(`📡 POST Request: ${tokenAmount} tokens of ${contractAddress}`);

        const result = await priceChecker.getTokenPriceInUSDC(contractAddress, tokenAmount);

        if (result.success) {
            res.json({
                success: true,
                data: result,
                metadata: {
                    requestId: `req_${Date.now()}`,
                    method: 'POST'
                }
            });
        } else {
            res.status(404).json({
                success: false,
                error: result.error,
                contractAddress,
                amount: tokenAmount
            });
        }

    } catch (error) {
        console.error('❌ POST API Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

// 3. GET Multiple Token Prices - Batch endpoint
app.post('/api/price/batch', async (req, res) => {
    try {
        const { tokens } = req.body;

        if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid tokens array',
                message: 'Please provide an array of tokens with contractAddress and amount',
                example: [
                    { contractAddress: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', amount: 100 },
                    { contractAddress: '5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC', amount: 1 }
                ]
            });
        }

        if (tokens.length > 10) {
            return res.status(400).json({
                success: false,
                error: 'Too many tokens',
                message: 'Maximum 10 tokens allowed per batch request'
            });
        }

        console.log(`📡 Batch Request: ${tokens.length} tokens`);

        const results = [];
        let totalValue = 0;

        for (const token of tokens) {
            if (!token.contractAddress || !isValidSolanaAddress(token.contractAddress)) {
                results.push({
                    contractAddress: token.contractAddress,
                    success: false,
                    error: 'Invalid contract address'
                });
                continue;
            }

            const amount = parseFloat(token.amount) || 1;
            const result = await priceChecker.getTokenPriceInUSDC(token.contractAddress, amount);
            
            if (result.success) {
                totalValue += result.pricing.totalValueUSDC;
            }
            
            results.push(result);

            // Rate limiting delay
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        res.json({
            success: true,
            data: {
                tokens: results,
                summary: {
                    totalTokens: tokens.length,
                    successfulPrices: results.filter(r => r.success).length,
                    failedPrices: results.filter(r => !r.success).length,
                    totalValueUSDC: totalValue.toFixed(6)
                }
            },
            metadata: {
                requestId: `batch_${Date.now()}`,
                processingTime: `~${tokens.length * 2}-${tokens.length * 5}s`
            }
        });

    } catch (error) {
        console.error('❌ Batch API Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

// 4. GET Token Search
app.get('/api/search/:query', async (req, res) => {
    try {
        const { query } = req.params;
        const { limit = 10 } = req.query;

        if (!query || query.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'Invalid search query',
                message: 'Search query must be at least 2 characters long'
            });
        }

        console.log(`🔍 Search Request: "${query}"`);

        const results = await priceChecker.searchTokens(query);
        const limitedResults = results.slice(0, parseInt(limit));

        res.json({
            success: true,
            data: {
                query,
                results: limitedResults,
                count: limitedResults.length,
                totalFound: results.length
            }
        });

    } catch (error) {
        console.error('❌ Search API Error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

// 5. GET Server Status and Health Check
app.get('/api/status', async (req, res) => {
    try {
        const status = {
            server: 'online',
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            priceChecker: priceChecker ? 'initialized' : 'not_initialized',
            uptime: process.uptime(),
            endpoints: [
                'GET /api/price/:contractAddress?amount=1',
                'POST /api/price',
                'POST /api/price/batch',
                'GET /api/search/:query',
                'GET /api/status'
            ]
        };

        // Test a quick price check to verify functionality
        try {
            const testResult = await priceChecker.getTokenPriceInUSDC(
                'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
                1
            );
            status.priceChecker = testResult.success ? 'working' : 'degraded';
            status.lastTestPrice = testResult.success ? 
                `1 USDC = $${testResult.pricing.pricePerToken}` : 
                testResult.error;
        } catch (error) {
            status.priceChecker = 'error';
            status.error = error.message;
        }

        res.json({
            success: true,
            data: status
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Status check failed',
            message: error.message
        });
    }
});

// Root endpoint with API documentation
app.get('/', (req, res) => {
    res.json({
        message: 'Solana Token Price API',
        version: '1.0.0',
        documentation: {
            endpoints: [
                {
                    method: 'GET',
                    path: '/api/price/:contractAddress',
                    description: 'Get token price in USDC',
                    parameters: {
                        contractAddress: 'Solana token contract address',
                        amount: 'Number of tokens (query parameter, default: 1)'
                    },
                    example: '/api/price/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm?amount=100'
                },
                {
                    method: 'POST',
                    path: '/api/price',
                    description: 'Get token price in USDC (POST method)',
                    body: {
                        contractAddress: 'string',
                        amount: 'number (optional)'
                    }
                },
                {
                    method: 'POST',
                    path: '/api/price/batch',
                    description: 'Get multiple token prices',
                    body: {
                        tokens: [
                            { contractAddress: 'string', amount: 'number' }
                        ]
                    }
                },
                {
                    method: 'GET',
                    path: '/api/search/:query',
                    description: 'Search for tokens by name or symbol',
                    parameters: {
                        query: 'Search term',
                        limit: 'Number of results (optional, default: 10)'
                    }
                },
                {
                    method: 'GET',
                    path: '/api/status',
                    description: 'Server health check and status'
                }
            ]
        },
        examples: {
            commonTokens: {
                WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
                PONKE: '5z3EqYQo9HiCEs3R84RCDMu2n7anpDMxRhdK8PSWmrRC',
                BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
                JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
                SOL: 'So11111111111111111111111111111111111111112',
                USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
            }
        }
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('❌ Unhandled Error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: 'An unexpected error occurred'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        message: `The endpoint ${req.method} ${req.path} does not exist`,
        availableEndpoints: [
            'GET /',
            'GET /api/status',
            'GET /api/price/:contractAddress',
            'POST /api/price',
            'POST /api/price/batch',
            'GET /api/search/:query'
        ]
    });
});

// Start server
async function startServer() {
    try {
        await initializeServer();
        
        app.listen(PORT, () => {
            console.log(`\n🚀 Solana Token Price API Server running on port ${PORT}`);
            console.log(`📡 API Base URL: http://localhost:${PORT}`);
            console.log(`📚 Documentation: http://localhost:${PORT}`);
            console.log(`❤️  Health Check: http://localhost:${PORT}/api/status`);
            console.log('\n📋 Ready for Postman testing!');
            console.log('='.repeat(50));
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error.message);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Server terminated');
    process.exit(0);
});

// Start the server
if (require.main === module) {
    startServer();
}

module.exports = app;