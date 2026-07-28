import 'ses';
import type { AsyncSqlDatabase, CreateIssuerConfig, OpenIssuerConfig } from '@finquick/ertp-dacct';
import { createIssuerKit, openIssuerKit, initGnuCashSchema, ensureGnuCashSchema } from '@finquick/ertp-dacct';
import type { IssuerKitWithPurseGuids, IssuerKitForCommodity } from '@finquick/ertp-dacct';

let confined = false;

export type DacctAPI = {
  createIssuerKit: (config: Omit<CreateIssuerConfig, 'db'>) => Promise<IssuerKitWithPurseGuids>;
  openIssuerKit: (config: Omit<OpenIssuerConfig, 'db'>) => Promise<IssuerKitForCommodity>;
  initGnuCashSchema: () => Promise<void>;
  ensureGnuCashSchema: () => Promise<void>;
};

export type { IssuerKitWithPurseGuids, IssuerKitForCommodity };
export type { AsyncSqlDatabase, CreateIssuerConfig, OpenIssuerConfig } from '@finquick/ertp-dacct';

export const makeConfinedDacct = async (db: AsyncSqlDatabase): Promise<DacctAPI> => {
  if (!confined) {
    lockdown({ errorTaming: 'unsafe' });
    confined = true;
  }
  return {
    createIssuerKit: config => createIssuerKit({ ...config, db }),
    openIssuerKit: config => openIssuerKit({ ...config, db }),
    initGnuCashSchema: () => initGnuCashSchema(db),
    ensureGnuCashSchema: () => ensureGnuCashSchema(db),
  };
};
