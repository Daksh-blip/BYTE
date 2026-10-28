export const GENDERS = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "nonbinary", label: "Non-binary" },
];

export const INTEREST_OPTIONS = [
  "Travel", "Coffee", "Music", "Hiking", "Cooking", "Books", "Tech", "Gaming", "Art", "Fitness",
  "Yoga", "Film", "Photography", "Dancing", "Wine", "Startups", "Running", "Anime", "Podcasts", "Plants",
  "Climbing", "Ocean", "Board Games", "AI", "Writing", "Astronomy", "Jazz", "Cycling", "Pets", "Fashion",
];

export const INTENTIONS = [
  { value: "long_term", label: "Long-term relationship", icon: "heart" },
  { value: "long_term_open", label: "Long-term, open to short", icon: "heart-half" },
  { value: "short_term_open", label: "Short-term, open to long", icon: "sparkles" },
  { value: "new_friends", label: "New friends", icon: "people" },
  { value: "figuring_out", label: "Still figuring it out", icon: "compass" },
] as const;

export const intentionLabel = (v?: string | null) => INTENTIONS.find((i) => i.value === v)?.label ?? null;

export const PROMPT_QUESTIONS = [
  "A perfect first date",
  "I geek out on",
  "Let's debate",
  "My simple pleasures",
  "You should message me if",
  "The way to win me over is",
  "My most irrational fear",
  "Two truths and a lie",
];

export const LANGUAGES = ["English", "Spanish", "French", "German", "Portuguese", "Hindi", "Arabic", "Mandarin", "Japanese", "Korean", "Italian"];

export const DISCOVER_MODES = [
  { value: "smart", label: "Smart Picks", icon: "sparkles" },
  { value: "explore", label: "Explore", icon: "compass" },
  { value: "interests", label: "Shared Interests", icon: "people" },
  { value: "new", label: "New Here", icon: "leaf" },
  { value: "goals", label: "Same Goals", icon: "heart", premium: true },
  { value: "prompts", label: "Has Prompts", icon: "chatbox-ellipses", premium: true },
] as const;

export const REPORT_REASONS = [
  "Fake profile or scam",
  "Inappropriate photos",
  "Harassment or threats",
  "Underage user",
  "Spam or selling",
  "Something else",
];
