// @flow

import type { Account } from "../../types";
import type { Core, CoreCurrency, CoreAccount } from "../../libcore/types";
import type { Transaction } from "./types";
import buildTransaction from "./libcore-buildTransaction";
import { BigNumber } from "bignumber.js";

async function cosmos(args: {
  account: Account,
  core: Core,
  coreAccount: CoreAccount,
  coreCurrency: CoreCurrency,
  transaction: Transaction,
  isPartial: boolean,
  isCancelled: () => boolean,
}) {
  console.log(args.transaction);
  const builded = await buildTransaction({ ...args, isPartial: true });
  if (!builded) return;
  const estimatedFees = BigNumber(await builded.getFee());
  return { estimatedFees };
}

export default cosmos;
