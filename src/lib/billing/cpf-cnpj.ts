// ============================================================
// Normaliza e valida (por formato, não por dígito verificador) um
// CPF ou CNPJ digitado pelo usuário. O Asaas valida o dígito
// verificador de verdade do lado deles e devolve um erro claro se
// for inválido — aqui só garantimos que o formato (11 ou 14
// dígitos) está plausível antes de gastar uma chamada de API.
// ============================================================

/** Remove tudo que não é dígito e confere se sobrou um CPF (11) ou CNPJ (14) válido em formato. Retorna null se não. */
export function normalizeCpfCnpj(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 || digits.length === 14) {
    return digits;
  }
  return null;
}
