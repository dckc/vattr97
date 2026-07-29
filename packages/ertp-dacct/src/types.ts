import type { IssuerKit } from './ertp-types.ts';
import type { Sealer } from './sealer.ts';
import type { ERef } from '@endo/eventual-send';
import type { DB } from './sql-db.ts';
import type { Guid } from './guids.ts';
import type { Zone } from './jessie-tools.ts';

export type CommodityNamespace = 'CURRENCY' | 'COMMODITY';

export type CommoditySpec = {
  namespace?: CommodityNamespace;
  mnemonic: string;
  fullname?: string;
  fraction?: number;
  quoteFlag?: number;
};

export type CreateIssuerConfig = {
  db: ERef<DB>;
  commodity: CommoditySpec;
  zone?: Zone;
  makeGuid: () => Guid;
  nowMs: () => number;
};

export type OpenIssuerConfig = {
  db: ERef<DB>;
  commodityGuid: Guid;
  zone?: Zone;
  makeGuid: () => Guid;
  nowMs: () => number;
};

export type NatIssuerKit = IssuerKit<'nat'>;

export type AmountLike = { brand: unknown; value: bigint };

export type AccountPurse = {
  deposit: (payment: object, optAmountShape?: unknown) => Promise<unknown>;
  withdraw: (amount: AmountLike) => Promise<object>;
  getCurrentAmount: () => Promise<AmountLike>;
};

export type AccountPurseAccess = {
  makeAccountPurse: (accountGuid: Guid) => Promise<AccountPurse>;
  openAccountPurse: (accountGuid: Guid) => Promise<AccountPurse>;
};

export type IssuerKitForCommodity = {
  kit: NatIssuerKit;
  accounts: AccountPurseAccess;
  purseGuids: WeakMap<AccountPurse, Guid>;
  payments: PaymentAccess;
  mintInfo: MintInfoAccess;
};

export type IssuerKitWithGuid = NatIssuerKit & { commodityGuid: Guid };

export type IssuerKitWithPurseGuids = IssuerKitWithGuid & {
  purses: {
    getGuid: (purse: unknown) => Guid;
    getGuidFromSealed: (sealedPurse: unknown) => Guid;
  };
  sealer: Sealer;
  payments: PaymentAccess;
  mintInfo: MintInfoAccess;
};

export type PaymentAccess = {
  getCheckNumber: (payment: unknown) => string;
  openPayment: (checkNumber: string) => object;
};

export type MintInfoAccess = {
  getMintInfo: () => {
    holdingAccountGuid: Guid;
    recoveryPurseGuid: Guid;
  };
};

export type ChartFacet = {
  placePurse: (args: {
    sealedPurse: unknown;
    name: string;
    parentGuid?: Guid | null;
    accountType?: string;
    placeholder?: boolean;
    code?: string | null;
  }) => Promise<void>;
  placePurseAtPath: (args: {
    sealedPurse: unknown;
    path: string[];
    accountType?: string;
    placeholder?: boolean;
    code?: string | null;
  }) => Promise<void>;
  placeAccount: (args: {
    accountGuid: Guid;
    name: string;
    parentGuid?: Guid | null;
    accountType?: string;
    placeholder?: boolean;
    code?: string | null;
  }) => Promise<void>;
};

export type EscrowFacet = {
  makeOffer: (
    left: { fromPurse: unknown; toPurse: unknown; amount: AmountLike },
    right: { fromPurse: unknown; toPurse: unknown; amount: AmountLike },
    checkNumber: string,
    description?: string,
  ) => {
    accept: () => void;
    cancel: () => void;
    getOfferId: () => string;
  };
};

export type { Guid } from './guids.ts';
