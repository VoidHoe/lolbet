// server/economy.js
// Pure money rules — no DB, no side effects. Integer Clout.

const START_BALANCE = 1000;

// Can `balance` cover `stake`? Stake must be a positive finite number.
function canBet(balance, stake) {
  if (!Number.isFinite(stake) || stake <= 0) return { ok: false, error: 'stake-invalid' };
  if (stake > balance) return { ok: false, error: 'insufficient' };
  return { ok: true };
}

// Winnings for a settled bet (gross, includes the returned stake).
function payout(stake, odds, won) {
  return won ? Math.round(stake * odds) : 0;
}

module.exports = { START_BALANCE, canBet, payout };
