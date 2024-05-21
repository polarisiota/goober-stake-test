"use client";

import "@solana/wallet-adapter-react-ui/styles.css";

import { Adapter } from "@solana/wallet-adapter-base";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { type ConnectionConfig } from "@solana/web3.js";

const WALLETS: Adapter[] = [];
const CONNECTION_CONFIG: ConnectionConfig = { commitment: "confirmed" };

export const AppProviders = ({ children }: { children: React.ReactNode }) => {
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL!;

  return (
    <ConnectionProvider endpoint={endpoint} config={CONNECTION_CONFIG}>
      <WalletProvider wallets={WALLETS} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
