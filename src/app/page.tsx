"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
import axios from "axios";
import { useState } from "react";
import { sendSignedTransaction } from "./common/utils/transaction";

export default function Home() {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();

  const [loading, setLoading] = useState(false);

  const onStakeClick = async () => {
    if (!publicKey || !signTransaction) return;

    try {
      setLoading(true);

      const result = await axios
        .post("https://api.tinys.pl/v1/stake/deposit", {
          userPublicKey: publicKey.toBase58(),
          mint: "CHHb5Dh1nLsCFrBr4JV2BvpqetHFmj1wUoq2f2UCbNQq",
          stakeConfigAddress: "2QsxqXGqFUEXomtukZ2YTzAAaKRGSkXifZrauskDq7tc",
        })
        .then((res) => res.data);

      const transaction = VersionedTransaction.deserialize(
        Buffer.from(result.base64EncodedTransaction, "base64")
      );

      const signedTransaction = await signTransaction(transaction);

      const { txid } = await sendSignedTransaction({
        signedTransaction,
        connection,
        commitment: "singleGossip",
      });

      console.log(txid);
    } catch (e) {
      console.log(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <WalletMultiButton />
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          className="border w-fit px-4 py-2 rounded-sm bg-slate-300"
          onClick={onStakeClick}
          disabled={loading}
        >
          {loading ? "Loading" : "Stake"}
        </button>
      </div>
    </div>
  );
}
