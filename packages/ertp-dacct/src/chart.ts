import { defaultZone } from './jessie-tools.ts';
import type { Zone } from './jessie-tools.ts';
import { dbGet, dbRun } from './sql-db.ts';
import type { DBRef } from './sql-db.ts';
import type { ChartFacet, Guid } from './types.ts';
import { requireAccountCommodity } from './db-helpers.ts';

export const makeChartFacet = ({
  db,
  commodityGuid,
  getGuidFromSealed,
  zone = defaultZone,
}: {
  db: DBRef;
  commodityGuid: Guid;
  getGuidFromSealed: (sealedPurse: unknown) => Guid;
  zone?: Zone;
}): ChartFacet => {
  const { exo } = zone;
  const updateAccount = async ({
    accountGuid,
    name,
    parentGuid,
    accountType,
    placeholder,
    code,
  }: {
    accountGuid: Guid;
    name: string;
    parentGuid: Guid | null;
    accountType: string;
    placeholder: boolean;
    code: string | null;
  }) => {
    await requireAccountCommodity({ db, accountGuid, commodityGuid });
    if (parentGuid !== null) {
      const row = await dbGet<[string], { guid: string }>(
        db,
        'SELECT guid FROM accounts WHERE guid = ?',
        parentGuid,
      );
      if (!row) {
        throw new Error('parent account not found');
      }
    }
    await dbRun(
      db,
      `
      UPDATE accounts SET name = ?, account_type = ?, parent_guid = ?, placeholder = ?, code = ?
      WHERE guid = ?
    `,
      name,
      accountType,
      parentGuid,
      placeholder ? 1 : 0,
      code,
      accountGuid,
    );
  };

  return exo('ChartFacet', {
    placePurse: async ({
      sealedPurse,
      name,
      parentGuid = null,
      accountType = 'ASSET',
      placeholder = false,
      code = null,
    }: {
      sealedPurse: unknown;
      name: string;
      parentGuid?: Guid | null;
      accountType?: string;
      placeholder?: boolean;
      code?: string | null;
    }) => {
      const purseGuid = getGuidFromSealed(sealedPurse);
      await updateAccount({
        accountGuid: purseGuid,
        name,
        parentGuid,
        accountType,
        placeholder,
        code,
      });
    },
    placeAccount: async ({
      accountGuid,
      name,
      parentGuid = null,
      accountType = 'ASSET',
      placeholder = false,
      code = null,
    }: {
      accountGuid: Guid;
      name: string;
      parentGuid?: Guid | null;
      accountType?: string;
      placeholder?: boolean;
      code?: string | null;
    }) => {
      await updateAccount({
        accountGuid,
        name,
        parentGuid,
        accountType,
        placeholder,
        code,
      });
    },
  });
};
