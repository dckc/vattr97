/**
 * @file The ledger's bootstrap object: ERTP issuer kits backed by a
 * GnuCash-schema SQL database, as passable remotables.
 */
import { Far } from '@endo/far';
import {
  createIssuerKit,
  type SqlDatabase,
  type Zone,
} from '@vattr/ertp-books/src/index.js';
import type { Guid } from '@vattr/ertp-books/src/types.js';

/** Marks ertp-books objects as remotables so CapTP can pass them. */
const farZone: Zone = {
  exo: (interfaceName, methods) => Far(interfaceName, methods),
};

export const makeLedgerBootstrap = ({
  db,
  makeGuid,
  nowMs,
}: {
  db: SqlDatabase;
  makeGuid: () => Guid;
  nowMs: () => number;
}) =>
  Far('LedgerBootstrap', {
    makeIssuerKit: (mnemonic: string) => {
      const { issuer, brand, mint } = createIssuerKit({
        db,
        commodity: { namespace: 'COMMODITY', mnemonic },
        makeGuid,
        nowMs,
        zone: farZone,
      });
      return harden({ issuer, brand, mint });
    },
  });
