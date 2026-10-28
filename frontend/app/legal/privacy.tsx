import { LegalPage } from "@/src/components/legal-page";
import { APP_NAME, COMPANY, SUPPORT_EMAIL } from "@/src/legal";

export default function Privacy() {
  return (
    <LegalPage
      testID="privacy-screen"
      title="Privacy Policy"
      intro={`${APP_NAME} is made by ${COMPANY} ("we", "us"). This policy explains what we collect, why, who we share it with, and the choices you have. ${APP_NAME} is for adults aged 18 and over.`}
      sections={[
        {
          title: "What we collect",
          body: [
            "Account details: your email address, a securely hashed password (if you use one), and whether you signed in with Google or Apple.",
            "Profile details you choose to add: name, birthday (only your age is shown to others), gender, who you're interested in, photos, bio, job, city, interests, languages, intention and prompt answers.",
            "Activity: likes, passes, notes sent with likes, matches, blocks, reports and appeals.",
            "Messages and chat photos: these are end-to-end encrypted on your device with the Signal Protocol. We store and relay only encrypted data we cannot read. Notes sent with a like are not end-to-end encrypted.",
            "Device and security data: encryption public keys, linked-device records, and sign-in session records used to keep your account secure.",
            "Purchases: if you subscribe, the app store and our payment partner tell us your subscription status. We never see your card details.",
          ],
        },
        {
          title: "How we use it",
          body: [
            "To run the service: create your account, show your profile, suggest matches, deliver messages and keep you signed in.",
            "To keep people safe: review reports, enforce our Terms, and prevent fraud and abuse.",
            "To send account emails such as verification codes, password resets and security alerts. We don't send marketing emails.",
          ],
        },
        {
          title: "AI features",
          body: [
            "Optional AI features (opening lines, date ideas, bio help) send profile text — such as names, ages, bios, interests and prompt answers of you and your match — to Anthropic, our AI provider, to generate suggestions. Your messages are never sent.",
            "Moderators may use AI to summarise a report. This uses the report's reason and details and the reported person's public profile. A person always makes the final decision.",
          ],
        },
        {
          title: "Who we share it with",
          body: [
            "Other members see your public profile. They never see your email or exact birthday.",
            "Service providers who process data for us: cloud hosting and storage, email delivery, Google and Apple sign-in, app-store subscriptions (RevenueCat, Google Play, Apple), and Anthropic for AI features.",
            "Authorities, when the law requires it or to protect someone from serious harm.",
            "We do not sell your personal data and we do not show ads.",
          ],
        },
        {
          title: "How long we keep it",
          body: [
            "We keep your data while your account is open. When you delete your account, we delete your profile, likes, matches, messages, linked devices and the reports you made. Your photo files become inaccessible right away and are removed from storage during routine cleanup.",
            "We may keep limited records of safety reports and enforcement actions where needed to protect others or meet legal duties.",
          ],
        },
        {
          title: "Your choices and rights",
          body: [
            "Edit your profile, pause it, or turn off read receipts at any time in the app.",
            "Download your data: Settings › Download my data.",
            `Delete your account: Settings › Delete account. If you can't access the app, email ${SUPPORT_EMAIL} from your account's email address and we'll delete it for you.`,
            "Depending on where you live, you may also have rights to access, correct, object to or restrict how we use your data. Contact us to use them.",
          ],
        },
        {
          title: "Security",
          body: [
            "Messages use end-to-end encryption, passwords are hashed, and access to our systems is restricted. No system is perfectly secure, so please use a strong, unique password.",
          ],
        },
        {
          title: "Changes",
          body: ["If we change this policy, we'll update the date above and tell you in the app when the change is significant."],
        },
      ]}
    />
  );
}
