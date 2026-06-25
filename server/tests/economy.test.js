// server/tests/economy.test.js
const { START_BALANCE, canBet, payout } = require('../economy');

test('START_BALANCE is 1000', () => {
  expect(START_BALANCE).toBe(1000);
});

test('canBet rejects non-positive and non-finite stakes', () => {
  expect(canBet(1000, 0)).toEqual({ ok: false, error: 'stake-invalid' });
  expect(canBet(1000, -5)).toEqual({ ok: false, error: 'stake-invalid' });
  expect(canBet(1000, NaN)).toEqual({ ok: false, error: 'stake-invalid' });
});

test('canBet rejects a stake above balance', () => {
  expect(canBet(50, 100)).toEqual({ ok: false, error: 'insufficient' });
});

test('canBet accepts a valid stake', () => {
  expect(canBet(100, 100)).toEqual({ ok: true });
  expect(canBet(100, 25)).toEqual({ ok: true });
});

test('payout pays round(stake×odds) on a win, 0 on a loss', () => {
  expect(payout(50, 1.9, true)).toBe(95);
  expect(payout(50, 1.85, true)).toBe(93); // 92.5 rounds to 93
  expect(payout(50, 1.9, false)).toBe(0);
});
