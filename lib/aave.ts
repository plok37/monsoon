// Aave v3 on Base: the Monsoon reserve. Idle USDC is supplied straight from
// the user's wallet (non-custodial); it accrues as aBasUSDC until withdrawn.
// Pool address verified on-chain: aBasUSDC.POOL() -> 0xA238...d1c5, and it is
// the same aToken Thetanuts wraps option collateral into.
import { Contract, formatUnits, parseUnits, type Provider, type Signer } from "ethers";

export const AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const A_BAS_USDC = "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB";

const POOL_ABI = [
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
  "function getReserveData(address) view returns (tuple(uint256 data) configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

/** Current USDC supply APY on Aave v3 Base (compounded from the ray-encoded APR). */
export async function getReserveApy(provider: Provider): Promise<number> {
  const pool = new Contract(AAVE_POOL, POOL_ABI, provider);
  const data = await pool.getReserveData(USDC);
  const apr = Number(data.currentLiquidityRate) / 1e27;
  return Math.pow(1 + apr / 31536000, 31536000) - 1;
}

export interface ReserveBalances {
  walletUsdc: number;
  reserveUsdc: number; // aBasUSDC balance (accrues in place)
}

export async function getReserveBalances(provider: Provider, address: string): Promise<ReserveBalances> {
  const usdc = new Contract(USDC, ERC20_ABI, provider);
  const aTok = new Contract(A_BAS_USDC, ERC20_ABI, provider);
  const [w, r] = await Promise.all([usdc.balanceOf(address), aTok.balanceOf(address)]);
  return {
    walletUsdc: Number(formatUnits(w, 6)),
    reserveUsdc: Number(formatUnits(r, 6)),
  };
}

/** Supply idle USDC into the reserve. Two wallet confirmations max (approve + supply). */
export async function supplyReserve(signer: Signer, amountUsdc: number): Promise<string> {
  const owner = await signer.getAddress();
  const amount = parseUnits(amountUsdc.toFixed(6), 6);
  const usdc = new Contract(USDC, ERC20_ABI, signer);
  const allowance: bigint = await usdc.allowance(owner, AAVE_POOL);
  if (allowance < amount) {
    const tx = await usdc.approve(AAVE_POOL, amount);
    await tx.wait();
  }
  const pool = new Contract(AAVE_POOL, POOL_ABI, signer);
  const tx = await pool.supply(USDC, amount, owner, 0);
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Withdraw from the reserve back to plain USDC. Pass Infinity to withdraw everything. */
export async function withdrawReserve(signer: Signer, amountUsdc: number): Promise<string> {
  const owner = await signer.getAddress();
  const amount = Number.isFinite(amountUsdc)
    ? parseUnits(amountUsdc.toFixed(6), 6)
    : (2n ** 256n - 1n); // Aave treats max-uint as "everything"
  const pool = new Contract(AAVE_POOL, POOL_ABI, signer);
  const tx = await pool.withdraw(USDC, amount, owner);
  const receipt = await tx.wait();
  return receipt.hash;
}
