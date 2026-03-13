/**
 * Profile is stored as free-form text in the DB.
 * The AI extracts structured contact info during the tailor step
 * and includes it in TailoredContent for PDF generation.
 *
 * ProfileSettings is kept for the browser agent to parse
 * structured data when filling forms.
 */
export interface ProfileSettings {
  name: string
  email: string
  phone: string
  street: string
  neighborhood: string
  city: string
  state: string
  cep: string
  country: string
  linkedin: string
  github: string
  instagram: string
  portfolio: string
  birthDate: string
  rg: string
  cpf: string
  motherName: string
  fatherName: string
}
