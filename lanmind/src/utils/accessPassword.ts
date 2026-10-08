export function generateAccessPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*';
  const limit = 256 - 256 % alphabet.length;
  let password = '';
  while (password.length < 16) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < limit) password += alphabet[byte % alphabet.length];
      if (password.length === 16) break;
    }
  }
  return password;
}
