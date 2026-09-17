/*
 * Theme metadata. The actual COLORS live in styles.css under
 * :root[data-theme="<key>"]. This file only holds the fun cosmetic bits
 * (badge emoji, tagline, sample Genie questions) applied when a theme is
 * selected. Add or edit themes here + in styles.css to extend the set.
 */
window.THEMES = {
  stlukes: {
    label: "St. Luke's",
    badge: "🩺",
    tagline: "St. Luke's Health System",
    sampleQuestions: [
      "How many patients have a CKD care gap?",
      "Show high-risk patients not seeing nephrology",
      "What is the undocumented CKD rate by provider?",
    ],
  },
  boisestate: {
    label: "Boise State",
    badge: "🐴",
    tagline: "Broncos • The Blue",
    sampleQuestions: [
      "Break this down by category",
      "What's the trend over the last 6 months?",
      "Show me the top 10 by volume",
    ],
  },
  motorcycle: {
    label: "Motorcycle",
    badge: "🏍️",
    tagline: "Full throttle analytics",
    sampleQuestions: [
      "What's driving the biggest change?",
      "Rank everything from highest to lowest",
      "Give me a quick summary of the numbers",
    ],
  },
  uidaho: {
    label: "University of Idaho",
    badge: "🌲",
    tagline: "Vandals • Gold & Black",
    sampleQuestions: [
      "Summarize the key metrics",
      "Compare this year to last year",
      "Which segment is growing fastest?",
    ],
  },
};
