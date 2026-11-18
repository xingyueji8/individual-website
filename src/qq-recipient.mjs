export function qqRecipientBinding(sender, fixed, saved, verifiedCode) {
  if (!sender) return "denied";
  if (fixed) return fixed === sender ? "unchanged" : "fixed-other";
  if (saved === sender) return "unchanged";
  return verifiedCode ? "save" : "denied";
}
