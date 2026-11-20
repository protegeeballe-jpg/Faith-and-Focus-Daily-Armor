const GUIDE_QUOTES = Object.freeze({
  "loc-home": "Where soft light falls across the floor, You’re safe and home you need no more.",
  "loc-office": "Beside your desk where quiet leaves sway, Find steady footing for today.",
  "loc-house": "May peace find you through an open door, With gentle grace upon the floor.",
  "loc-out": "Along the path where blossoms bend, The open sky is all you need to tend.",
  "start-1": "Three priceless sparks upon the page, To light the morning’s opening stage.",
  "start-2": "With folded hands and quiet grace, Let morning warmth fill up this space.",
  "start-3": "Reach toward the sky, uncurl, and sway, And wake your body to the day.",
  "start-4": "Lift up the glass, take a sip, And let cool water nourish you deep.",
  "mid-1": "Unclench your jaw, let shoulders fall, And sit once more both soft and tall.",
  "mid-2": "Breathe in the calm, hold soft and still, Then sigh the weight beyond the hill.",
  "mid-3": "Step from the rush, pause where you stand, And lift cool comfort in your hand.",
  "mid-4": "Rest one warm hand upon your chest, And let each feeling be a guest.",
  "mid-5": "Open your palm, like a fart let it go, A passing cloud, unhurried, slow.",
  "end-1": "Three golden stars for things you’ve done. Small quiet victories, one by one.",
  "end-2": "Three gentle lines for morning’s light, So you can lay them down tonight.",
  "end-3": "As amber skies begin to fade, Drink in the quiet you have made.",
  "end-4": "A playful tap upon your nose. You did so well, God always knows!",
  "sleep-1": "Remember kindness shared today, And tuck three blooms of thanks away.",
  "sleep-2": "Three golden lights in evening’s hush, To bless the night without a rush.",
  "sleep-3": "Put out the glow, set screens aside, Let softer lamplight be your guide.",
  "sleep-4": "Beneath the moon’s pale, silver gleam, Fold hands in peace and drift in gratefulness to dream.",
  "sleep-5": "Another sip before you sleep, Then let the quiet night run deep.",
  "cloud-checked": "Choose just one cloud and watch it glide, While others wait in peaceful stride."
});

export const GUIDE_QUOTE_IDS = Object.freeze(Object.keys(GUIDE_QUOTES));

export function getGuideQuote(rawId) {
  if (typeof rawId !== 'string' || !Object.prototype.hasOwnProperty.call(GUIDE_QUOTES, rawId)) {
    throw new Error('[GuideQuoteError] Unregistered guide quote requested: "' + String(rawId) + '"');
  }
  return GUIDE_QUOTES[rawId];
}
