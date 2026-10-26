/**
 * Whether the user has already been to the first-run wizard and left.
 *
 * The wizard's "skip later" led straight back to the front page, and
 * the front page sent the user straight back to the wizard — for ever,
 * with no explanation. A user who has not configured a provider yet, or
 * who wants to use their own key later, was trapped in the loop.
 *
 * The flag is kept in the browser: it says something about this device
 * and this user, and it has to survive the reload that would otherwise
 * start the loop again.
 */
const ONBOARDING_DISMISSED_KEY = "mirrai-onboarding-dismissed";

export function dismissOnboarding(): void {
  try {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
  } catch {
    // A browser that will not keep it is not a problem.
  }
}

export function onboardingDismissed(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}
