import { defaultZone } from './jessie-tools.ts';
import type { Zone } from './jessie-tools.ts';
import { dbAll, dbGet, dbRun } from './sql-db.ts';
import type { DBRef } from './sql-db.ts';
import type { ChartFacet, Guid } from './types.ts';
import {
  ensureAccountRow,
  requireAccountCommodity,
} from './db-helpers.ts';
import { makeDeterministicGuid } from './guids.ts';

export const makeChartFacet = ({
  db,
  commodityGuid,
  getGuidFromSealed,
  accountType: defaultAccountType = 'ASSET',
  zone = defaultZone,
}: {
  db: DBRef;
  commodityGuid: Guid;
  getGuidFromSealed: (sealedPurse: unknown) => Guid;
  accountType?: string;
  zone?: Zone;
}): ChartFacet => {
  const { exo } = zone;
  const resolveParentPath = async (path: string[]): Promise<Guid> => {
    const root = await dbGet<
      [],
      { guid: string; commodity_guid: string | null }
    >(
      db,
      `
        SELECT root.guid, root.commodity_guid
        FROM books
        JOIN accounts AS root ON root.guid = books.root_account_guid
        LIMIT 1
      `,
    );
    if (!root || root.commodity_guid === null) {
      throw new Error('book root account not found');
    }
    let parentGuid = root.guid as Guid;
    for (const [index, name] of path.entries()) {
      const matches = await dbAll<
        [string, string],
        { guid: string }
      >(
        db,
        `
          SELECT guid
          FROM accounts
          WHERE parent_guid = ? AND name = ?
        `,
        parentGuid,
        name,
      );
      if (matches.length > 1) {
        throw new Error(`ambiguous account path component: ${name}`);
      }
      const existingGuid = matches[0]?.guid;
      if (existingGuid) {
        parentGuid = existingGuid as Guid;
        continue;
      }
      const accountGuid = makeDeterministicGuid(
        `dacct-account-path:${root.guid}:${JSON.stringify(
          path.slice(0, index + 1),
        )}`,
      );
      await ensureAccountRow({
        db,
        accountGuid,
        name,
        commodityGuid: root.commodity_guid as Guid,
        accountType: 'ASSET',
        parentGuid,
      });
      parentGuid = accountGuid;
    }
    return parentGuid;
  };

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

  const placePurse = async ({
    sealedPurse,
    name,
    parentGuid = null,
    accountType = defaultAccountType,
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
  };

  const placeAccount = async ({
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
  };

  return exo('ChartFacet', {
    placePurse,
    placePurseAtPath: async ({
      sealedPurse,
      path,
      accountType = defaultAccountType,
      placeholder = false,
      code = null,
    }: {
      sealedPurse: unknown;
      path: string[];
      accountType?: string;
      placeholder?: boolean;
      code?: string | null;
    }) => {
      if (path.length === 0) {
        throw new Error('account path must not be empty');
      }
      if (path.some(name => name.length === 0)) {
        throw new Error('account path names must not be empty');
      }
      const name = path[path.length - 1]!;
      const parentGuid = await resolveParentPath(path.slice(0, -1));
      await placePurse({
        sealedPurse,
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
    }) => placeAccount({
      accountGuid,
      name,
      parentGuid,
      accountType,
      placeholder,
      code,
    }),
    placeAccountAtPath: async ({
      accountGuid,
      path,
      accountType = 'ASSET',
      placeholder = false,
      code = null,
    }: {
      accountGuid: Guid;
      path: string[];
      accountType?: string;
      placeholder?: boolean;
      code?: string | null;
    }) => {
      if (path.length === 0) {
        throw new Error('account path must not be empty');
      }
      if (path.some(name => name.length === 0)) {
        throw new Error('account path names must not be empty');
      }
      const name = path[path.length - 1]!;
      const parentGuid = await resolveParentPath(path.slice(0, -1));
      await placeAccount({
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
