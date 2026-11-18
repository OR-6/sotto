// Situation packs: a short digest of what matters in a situation, the who-chip it implies,
// and vocabulary that biases the on-device recogniser. Data only; versioned by
// Remote Config `packs_version`. English only until another language is tested.

export type Pack = {
  id: string;
  label: string;
  /** Who usually talks to the user in this situation. */
  partner: string;
  /** Which mode this situation usually calls for. */
  mode: 'say' | 'ask';
  /** ≤ 60 words for the small model: what matters here and what to watch for. */
  digest: string;
  /** Phrases for the speech recogniser's bias list. */
  vocab: string[];
};

export const PACKS_VERSION = 1;

export const PACKS: readonly Pack[] = [
  {
    id: 'cafe',
    label: 'Café',
    partner: 'the barista',
    mode: 'say',
    digest: 'Ordering food or drink at a counter. Short friendly answers. Size, milk, hot or iced, to stay or to go, paying by card or cash, name for the cup.',
    vocab: ['oat milk', 'flat white', 'to go', 'for here', 'tap your card', 'anything else', 'small medium or large', 'iced'],
  },
  {
    id: 'doctor',
    label: 'Doctor',
    partner: 'my doctor',
    mode: 'ask',
    digest: 'A medical appointment. Watch for a diagnosis, test results, treatment options, side effects, follow-up dates and referrals. The person should understand what was found, what happens next and what they can choose.',
    vocab: ['MRI', 'scan', 'referral', 'prescription', 'side effects', 'conservative management', 'follow-up', 'blood test'],
  },
  {
    id: 'pharmacy',
    label: 'Pharmacy',
    partner: 'the pharmacist',
    mode: 'ask',
    digest: 'Collecting or asking about medicine. Watch for how and when to take it, what to avoid, interactions and what to do if a dose is missed. Never invent doses.',
    vocab: ['prescription', 'dose', 'twice a day', 'with food', 'side effects', 'generic', 'repeat prescription', 'interactions'],
  },
  {
    id: 'landlord',
    label: 'Landlord',
    partner: 'my landlord',
    mode: 'ask',
    digest: 'A conversation about a rented home. Watch for rent changes, deadlines, repairs, deposits, notice periods and anything to sign. The person should know what is being asked, by when, and what is in writing.',
    vocab: ['rent increase', 'deposit', 'notice period', 'tenancy agreement', 'repairs', 'service costs', 'sign here', 'inspection'],
  },
  {
    id: 'municipality',
    label: 'Municipality',
    partner: 'the official',
    mode: 'ask',
    digest: 'An appointment at a government office. Watch for documents needed, deadlines, fees, appointments and decisions about permits or benefits. The person should leave knowing the next step and the date.',
    vocab: ['registration', 'appointment', 'proof of address', 'residence permit', 'application', 'fee', 'decision', 'objection'],
  },
  {
    id: 'bank',
    label: 'Bank',
    partner: 'the bank adviser',
    mode: 'ask',
    digest: 'A bank conversation about an account, a loan or a payment problem. Watch for fees, interest, contract terms, deadlines and anything that commits the person. They should know the total cost.',
    vocab: ['interest rate', 'fee', 'overdraft', 'direct debit', 'contract', 'term', 'monthly payment', 'identification'],
  },
  {
    id: 'school',
    label: 'School meeting',
    partner: 'the teacher',
    mode: 'ask',
    digest: 'A meeting at school about a child. Watch for concerns raised, support offered, assessments, decisions about the child, and what the parent is asked to do and by when.',
    vocab: ['assessment', 'support plan', 'progress', 'attendance', 'referral', 'meeting', 'special needs', 'follow-up'],
  },
  {
    id: 'family',
    label: 'Family',
    partner: 'my family',
    mode: 'say',
    digest: 'A relaxed conversation with family at home. Warm, casual, short. Plans, food, how everyone is, jokes.',
    vocab: ['dinner', 'this weekend', 'how are you', 'the kids', 'tomorrow', 'love you'],
  },
];

export const packById = (id: string): Pack | undefined => PACKS.find((p) => p.id === id);
