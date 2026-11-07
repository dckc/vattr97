export const Nat = (specimen: bigint) => {
  if (typeof specimen !== 'bigint') {
    throw new Error('amount must be bigint');
  }
  if (specimen < 0n) {
    throw new Error('amount must be non-negative');
  }
  return specimen;
};
