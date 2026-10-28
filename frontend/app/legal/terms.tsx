import { LegalPage } from "@/src/components/legal-page";
import { APP_NAME, COMPANY, SUPPORT_EMAIL } from "@/src/legal";

export default function Terms() {
  return (
    <LegalPage
      testID="terms-screen"
      title="Terms of Service"
      intro={`These terms are an agreement between you and ${COMPANY}, the maker of ${APP_NAME}. By creating an account or using the app, you agree to them.`}
      sections={[
        {
          title: "Who can use BYTE TALKS",
          body: [
            "You must be at least 18 years old, able to agree to these terms, and not barred from using dating services by law or by a previous ban from us.",
            "One person, one account. Keep your sign-in details private; you're responsible for activity on your account.",
          ],
        },
        {
          title: "Be real and respectful",
          body: [
            "Use your own photos and true information. Don't impersonate anyone.",
            "No harassment, hate, threats, sexual content involving minors, nudity in profile photos, spam, scams, or requests for money.",
            "Don't use the app for commercial promotion or to collect other members' information.",
          ],
        },
        {
          title: "Safety and moderation",
          body: [
            "You can block or report anyone from their profile or chat. We review reports and may warn, suspend or ban accounts that break these terms. Suspended or banned members can appeal in the app.",
            "Messages are end-to-end encrypted, so we can't read them. When you report someone, we rely on the details you give us.",
            "We don't run criminal background checks. Meet in public, tell a friend your plans, and read the safety tips in the app.",
          ],
        },
        {
          title: "Your content",
          body: [
            "You own what you post. You give us a limited licence to host and show your profile content to other members so the service can work. This ends when you delete the content or your account.",
          ],
        },
        {
          title: "Premium subscriptions",
          body: [
            "Premium is billed through the Google Play or Apple App Store account you use to subscribe, and renews automatically until you cancel in that store's subscription settings at least 24 hours before renewal.",
            "Refunds follow the store's policies. Safety features such as blocking and reporting are never behind a paywall.",
          ],
        },
        {
          title: "AI suggestions",
          body: ["AI suggestions are optional and can be wrong. Read them before you send anything — what you send is your responsibility."],
        },
        {
          title: "Ending your account",
          body: [
            "You can delete your account at any time in Settings. We may suspend or close accounts that break these terms or put others at risk.",
          ],
        },
        {
          title: "Disclaimers and liability",
          body: [
            "The service is provided \"as is\". We can't guarantee matches, availability, or how other members behave. To the extent the law allows, our liability is limited to the amount you paid us in the 12 months before the claim. Nothing in these terms limits rights you have under consumer law.",
          ],
        },
        {
          title: "Changes and governing law",
          body: [
            "We may update these terms. If changes are significant we'll tell you in the app; continuing to use the app means you accept them.",
            `These terms are governed by the laws of the country where ${COMPANY} is registered, unless the law where you live gives you the right to use local law or courts. For any problem, contact ${SUPPORT_EMAIL} first — most issues can be solved quickly.`,
          ],
        },
      ]}
    />
  );
}
