export interface Account {
  id: string;
  name: string;
  type: "bank" | "crypto" | "payment";
  currency: string;
  balance: number;
  balanceUSD: number;
  icon: string;
  color: string;
}

export const accounts: Account[] = [
  {
    id: "crypto-wallet-usdc",
    name: "Crypto Wallet",
    type: "crypto",
    currency: "USDC",
    balance: 35000,
    balanceUSD: 35000,
    icon: "Wallet",
    color: "#3B82F6",
  },
  {
    id: "mercury-bank",
    name: "Mercury Bank",
    type: "bank",
    currency: "EUR",
    balance: 41000,
    balanceUSD: 45200,
    icon: "Building2",
    color: "#6366F1",
  },
  {
    id: "base-wallet",
    name: "Base Wallet",
    type: "crypto",
    currency: "ETH + USDC",
    balance: 8200,
    balanceUSD: 8200,
    icon: "CircleDollarSign",
    color: "#8B5CF6",
  },
  {
    id: "stripe",
    name: "Stripe",
    type: "payment",
    currency: "USD",
    balance: 3150,
    balanceUSD: 3150,
    icon: "CreditCard",
    color: "#10B981",
  },
];

export const totalBalance = accounts.reduce(
  (sum, a) => sum + a.balanceUSD,
  0
);

export const fiatBalance = accounts
  .filter((a) => a.type === "bank" || a.type === "payment")
  .reduce((sum, a) => sum + a.balanceUSD, 0);

export const cryptoBalance = accounts
  .filter((a) => a.type === "crypto")
  .reduce((sum, a) => sum + a.balanceUSD, 0);
