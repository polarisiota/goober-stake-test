import { WalletContextState } from "@solana/wallet-adapter-react";
import {
  Commitment,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  SignatureStatus,
  Transaction,
  TransactionInstruction,
  TransactionSignature,
  VersionedTransaction,
} from "@solana/web3.js";

const DEFAULT_TIMEOUT = 180000;
const isDevMode = process.env.NODE_ENV === "development";

export const wait = (milliseconds: number) => {
  // eslint-disable-next-line no-promise-executor-return
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
};

export async function awaitTransactionSignatureConfirmation(
  txid: TransactionSignature,
  timeout: number,
  connection: Connection,
  commitment: Commitment = "recent",
  queryStatus = false
) {
  let done = false;
  let status: SignatureStatus | null = {
    slot: 0,
    confirmations: 0,
    err: null,
  };
  let subId: number | null;
  await new Promise((resolve, reject) => {
    (async () => {
      setTimeout(() => {
        if (done) {
          return;
        }
        done = true;
        reject(new Error("timeout"));
      }, timeout);
      try {
        subId = connection.onSignature(
          txid,
          (result, context) => {
            subId = null;
            done = true;
            status = {
              err: result.err,
              slot: context.slot,
              confirmations: 0,
            };
            if (result.err) {
              if (isDevMode) {
                // eslint-disable-next-line no-console
                console.log("Rejected via websocket", result.err);
              }
              if (result.err === null) {
                resolve(result.err);
              } else {
                reject(result.err);
              }
            } else {
              if (isDevMode) {
                // eslint-disable-next-line no-console
                console.log("Resolved via websocket", result);
              }
              resolve(result);
            }
          },
          commitment
        );
      } catch (e) {
        done = true;
        if (isDevMode) {
          // eslint-disable-next-line no-console
          console.error("WS error in setup", txid, e);
        }
      }

      while (!done && queryStatus) {
        /* eslint-disable */
        (async () => {
          try {
            const signatureStatuses = await connection.getSignatureStatuses([
              txid,
            ]);
            status = signatureStatuses && signatureStatuses.value[0];
            if (!done) {
              if (!status) {
                if (isDevMode) {
                  console.log("REST null result for", txid, status);
                }
              } else if (status.err) {
                if (isDevMode) {
                  console.log("REST error for", txid, status);
                }
                done = true;
                reject(status.err);
              } else if (!status.confirmations) {
                if (isDevMode) {
                  console.log("REST no confirmations for", txid, status);
                }
              } else {
                if (isDevMode) {
                  console.log("REST confirmation for", txid, status);
                }
                done = true;
                resolve(status);
              }
            }
          } catch (e) {
            if (!done) {
              if (isDevMode) {
                console.log("REST connection error: txid", txid, e);
              }
            }
          }
        })();
        // eslint-disable-next-line no-await-in-loop
        await wait(2000);
      }
    })();
  })
    .catch((err) => {
      if ((err as Error).message === "timeout" && status) {
        status = null;
      }
      if (subId !== null) {
        connection.removeSignatureListener(subId);
        subId = null;
      }
    })
    .then((_) => {
      if (subId !== null) {
        connection.removeSignatureListener(subId);
        subId = null;
      }
    });
  done = true;
  return status;
}

export const sendTransactionWithRetry = async (
  connection: Connection,
  wallet: WalletContextState,
  instructions: TransactionInstruction[],
  signers: Keypair[],
  computeUnits = 0,
  priorityRate = 0,
  commitment: Commitment = "singleGossip",
  includesFeePayer: boolean = false,
  beforeSend?: () => void
) => {
  if (!wallet.publicKey) throw new Error("Wallet not connected");

  let transaction = new Transaction();
  if (computeUnits > 0) {
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: computeUnits,
    });
    transaction.add(modifyComputeUnits);
  }

  if (priorityRate > 0) {
    transaction.add(getPriorityFeeIx(priorityRate));
  }

  instructions.forEach((instruction) => transaction.add(instruction));

  const latestBlockhash = await connection.getLatestBlockhash(commitment);
  transaction.recentBlockhash = latestBlockhash.blockhash;
  transaction.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;

  transaction.feePayer = wallet.publicKey;

  if (signers.length > 0) {
    transaction.partialSign(...signers);
  }
  if (!includesFeePayer) {
    transaction = await wallet.signTransaction!(transaction);
  }

  if (beforeSend) {
    beforeSend();
  }

  const { txid, slot } = await sendSignedTransaction({
    connection,
    signedTransaction: transaction,
    commitment,
  });

  return { txid, slot };
};

export interface Txn {
  txid: string | null;
  slot: number | null;
}

export async function sendSignedTransaction({
  signedTransaction,
  connection,
  commitment,
  timeout = DEFAULT_TIMEOUT,
}: {
  signedTransaction: Transaction | VersionedTransaction;
  connection: Connection;
  commitment: Commitment;
  timeout?: number;
}): Promise<Txn> {
  const rawTransaction = signedTransaction.serialize();
  const startTime = getUnixTs();
  let slot = 0;
  const txid: TransactionSignature = await connection.sendRawTransaction(
    rawTransaction,
    {
      skipPreflight: true,
    }
  );

  if (isDevMode) {
    console.log("Started awaiting confirmation for", txid);
  }

  let done = false;
  (async () => {
    while (!done && getUnixTs() - startTime < timeout) {
      connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
      });
      // eslint-disable-next-line no-await-in-loop
      await wait(500);
    }
  })();
  try {
    const confirmation = await awaitTransactionSignatureConfirmation(
      txid,
      timeout,
      connection
    );
    if (!confirmation)
      throw new Error("Timed out awaiting confirmation on transaction");

    if (confirmation.err) {
      throw confirmation.err;
    }

    slot = confirmation?.slot || 0;
  } catch (err: any) {
    if (isDevMode) {
      console.error(err);
    }
    throw new Error("Transaction failed");
  } finally {
    done = true;
  }

  if (isDevMode) {
    console.log("Latency", txid, getUnixTs() - startTime);
  }
  return { txid, slot };
}

export const getUnixTs = () => new Date().getTime() / 1000;

export const reduceSettledPromise = <T>(
  settledPromise: PromiseSettledResult<T>[]
) => {
  return settledPromise.reduce(
    (
      acc: {
        rejected: string[];
        fulfilled: T[];
      },
      cur
    ) => {
      if (cur.status === "fulfilled") acc.fulfilled.push(cur.value);
      if (cur.status === "rejected") acc.rejected.push(cur.reason);
      return acc;
    },
    { rejected: [], fulfilled: [] }
  );
};

interface QueueVersionedTransactionSignProps {
  transactions: VersionedTransaction[];
  signTransaction: <T extends VersionedTransaction>(
    transaction: T
  ) => Promise<T>;
  signAllTransactions:
    | (<T extends VersionedTransaction>(transactions: T[]) => Promise<T[]>)
    | undefined;
  txInterval: number; //How long to wait between signing in milliseconds
  connection: Connection;
}

export async function queueVersionedTransactionSign({
  transactions,
  signAllTransactions,
  signTransaction,
  txInterval,
  connection,
}: QueueVersionedTransactionSignProps) {
  let signedTxs: VersionedTransaction[] = [];

  if (signAllTransactions) {
    signedTxs = await signAllTransactions(transactions);
  } else {
    //fallback to sign tx batches individually (if wallet doesn't support signAll)
    const settledTxs = await Promise.allSettled(
      transactions.map(async (tx) => {
        const signedTx = await signTransaction(tx);
        return signedTx;
      })
    );
    const { fulfilled } = reduceSettledPromise(settledTxs);

    signedTxs = fulfilled;
  }

  const pendingSigned = await Promise.allSettled(
    signedTxs.map((tx, i, allTx) => {
      // send all tx in intervals to avoid overloading the network
      return new Promise<{ tx: string; id: number }>((resolve, reject) => {
        setTimeout(() => {
          // eslint-disable-next-line no-console
          console.log(`Requesting Transaction ${i + 1}/${allTx.length}`);
          connection
            .sendRawTransaction(tx.serialize(), { skipPreflight: true })
            .then(async (txHash) => {
              // eslint-disable-next-line no-console
              console.log("Started awaiting confirmation for", txHash);

              const confirmation = await awaitTransactionSignatureConfirmation(
                txHash,
                DEFAULT_TIMEOUT,
                connection
              );

              if (!confirmation)
                throw new Error(
                  "Timed out awaiting confirmation on transaction"
                );

              if (confirmation.err) {
                if (isDevMode) {
                  // eslint-disable-next-line no-console
                  console.error(confirmation.err);
                }
                throw new Error("Transaction failed: Custom instruction error");
              }

              resolve({ tx: txHash, id: i });
            })
            .catch((e) => {
              reject(e);
            });
        }, i * txInterval);
      });
    })
  );

  return pendingSigned;
}

const getPriorityFeeIx = (priorityRate = 100) =>
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityRate });

export const getTxFee = async (
  connection: Connection,
  txId: string
): Promise<number> => {
  const txResult = await connection.getTransaction(txId);
  return txResult?.meta?.fee ?? 0;
};
