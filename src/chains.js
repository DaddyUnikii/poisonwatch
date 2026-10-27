// Chain registry. Every RPC here is a free public endpoint; pass --rpc to use your own.
// `tokens` lists the canonical contracts of the tokens poisoners love to fake. A token whose
// symbol matches one of these but whose contract does not is treated as a fake.
export const CHAINS = {
  eth: { id: 1, name: 'Ethereum', native: 'ETH', blockTime: 12,
    rpc: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com', 'https://cloudflare-eth.com'],
    blockscout: 'https://eth.blockscout.com/api',
    explorer: 'https://etherscan.io',
    tokens: {
      USDT: ['0xdac17f958d2ee523a2206206994597c13d831ec7'],
      USDC: ['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'],
      WETH: ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'],
      DAI: ['0x6b175474e89094c44da98b954eedeac495271d0f'],
    } },
  bsc: { id: 56, name: 'BNB Chain', native: 'BNB', blockTime: 0.75,
    rpc: ['https://bsc-rpc.publicnode.com', 'https://bsc.rpc.blxrbdn.com', 'https://bsc-dataseed.bnbchain.org', 'https://bsc.drpc.org'],
    explorer: 'https://bscscan.com',
    tokens: {
      USDT: ['0x55d398326f99059ff775485246999027b3197955'],
      USDC: ['0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'],
      BUSD: ['0xe9e7cea3dedca5984780bafc599bd69add087d56'],
      WBNB: ['0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'],
      ETH: ['0x2170ed0880ac9a755fd29b2688956bd959f933f8'],
    } },
  base: { id: 8453, name: 'Base', native: 'ETH', blockTime: 2,
    rpc: ['https://base-rpc.publicnode.com', 'https://mainnet.base.org'],
    blockscout: 'https://base.blockscout.com/api',
    explorer: 'https://basescan.org',
    tokens: {
      USDC: ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'],
      USDBC: ['0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca'],
      USDT: ['0xfde4c96c8593536e31f229ea8f37b2ada2699bb2'],
      WETH: ['0x4200000000000000000000000000000000000006'],
    } },
  arb: { id: 42161, name: 'Arbitrum', native: 'ETH', blockTime: 0.25,
    rpc: ['https://arbitrum-one-rpc.publicnode.com', 'https://arb1.arbitrum.io/rpc'],
    blockscout: 'https://arbitrum.blockscout.com/api',
    explorer: 'https://arbiscan.io',
    tokens: {
      USDC: ['0xaf88d065e77c8cc2239327c5edb3a432268e5831', '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8'],
      USDT: ['0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9'],
      WETH: ['0x82af49447d8a07e3bd95bd0d56f35241523fbab1'],
    } },
  op: { id: 10, name: 'Optimism', native: 'ETH', blockTime: 2,
    rpc: ['https://optimism-rpc.publicnode.com', 'https://mainnet.optimism.io'],
    blockscout: 'https://explorer.optimism.io/api',
    explorer: 'https://optimistic.etherscan.io',
    tokens: {
      USDC: ['0x0b2c639c533813f4aa9d7837caf62653d097ff85', '0x7f5c764cbc14f9669b88837ca1490cca17c31607'],
      USDT: ['0x94b008aa00579c1307b0ef2c499ad98a8ce58e58'],
      WETH: ['0x4200000000000000000000000000000000000006'],
    } },
  polygon: { id: 137, name: 'Polygon', native: 'POL', blockTime: 2,
    rpc: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'],
    blockscout: 'https://polygon.blockscout.com/api',
    explorer: 'https://polygonscan.com',
    tokens: {
      USDT: ['0xc2132d05d31c914a87c6611c10748aeb04b58e8f'],
      USDC: ['0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'],
      WETH: ['0x7ceb23fd6bc0add59e62ac25578270cff1b9f619'],
      WMATIC: ['0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'],
      WPOL: ['0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270'],
      POL: ['0x0000000000000000000000000000000000001010'],
      MATIC: ['0x0000000000000000000000000000000000001010'],
    } },
};

export const ALIASES = { ethereum: 'eth', mainnet: 'eth', bnb: 'bsc', binance: 'bsc', arbitrum: 'arb', optimism: 'op', matic: 'polygon' };

export function resolveChain(key) {
  const k = String(key).toLowerCase();
  const name = CHAINS[k] ? k : ALIASES[k];
  if (!name) throw new Error(`unknown chain "${key}" (try: ${Object.keys(CHAINS).join(', ')}, auto, all)`);
  return { key: name, ...CHAINS[name] };
}
