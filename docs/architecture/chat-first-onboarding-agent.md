# Chat-first onboarding

Onboarding gathers only the minimum company profile needed to create a scoped
workspace. The conversational flow validates the company name, jurisdiction,
business type, and user intent before persistence.

The flow must tolerate partial answers, clearly distinguish optional fields,
and never infer legal identity or permissions from free-form text. Company and
user records are created only after authenticated confirmation.
