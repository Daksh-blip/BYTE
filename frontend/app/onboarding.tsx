import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInRight } from "react-native-reanimated";

import { api, Me } from "@/src/api";
import { useAuth } from "@/src/auth";
import { GENDERS, INTEREST_OPTIONS, INTENTIONS } from "@/src/constants";
import { PhotoGrid } from "@/src/components/photo-grid";
import { Button, Chip, Field, IconButton } from "@/src/components/ui";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

const STEPS = ["Birthday", "About you", "Photos", "Your vibe"];

export default function Onboarding() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, setUser, signOut } = useAuth();
  const [step, setStep] = useState(0);
  const init = user?.dob?.split("-") ?? [];
  const [year, setYear] = useState(init[0] ?? "");
  const [month, setMonth] = useState(init[1] ?? "");
  const [day, setDay] = useState(init[2] ?? "");
  const [gender, setGender] = useState<string | null>(user?.gender ?? null);
  const [interestedIn, setInterestedIn] = useState<string[]>(user?.interested_in ?? []);
  const [intention, setIntention] = useState<string | null>(user?.intention ?? null);
  const [bio, setBio] = useState(user?.bio ?? "");
  const [job, setJob] = useState(user?.job ?? "");
  const [city, setCity] = useState(user?.city ?? "");
  const [interests, setInterests] = useState<string[]>(user?.interests ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (body: object) => {
    const me = await api<Me>("/me", { method: "PUT", body });
    setUser(me);
  };

  const next = async () => {
    setError(null);
    setBusy(true);
    try {
      if (step === 0) {
        const y = parseInt(year, 10), m = parseInt(month, 10), d = parseInt(day, 10);
        if (!y || !m || !d || m > 12 || d > 31 || year.length !== 4) throw new Error("Enter a valid date of birth");
        await save({ dob: `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` });
      } else if (step === 1) {
        if (!gender) throw new Error("Choose how you identify");
        if (!interestedIn.length) throw new Error("Choose who you'd like to meet");
        await save({ gender, interested_in: interestedIn, ...(intention ? { intention } : {}) });
      } else if (step === 2) {
        if (!user?.photos.length) throw new Error("Add at least one photo");
      } else {
        if (interests.length < 3) throw new Error("Pick at least 3 interests");
        await save({ bio: bio.trim(), job: job.trim(), city: city.trim(), interests, onboarded: true });
        router.replace("/discover");
        return;
      }
      setStep(step + 1);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (arr: string[], v: string, set: (a: string[]) => void, max = 99) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : arr.length >= max ? arr : [...arr, v]);

  return (
    <View style={s.root} testID="onboarding-screen">
      <View style={[s.header, { paddingTop: insets.top + spacing.sm }]}>
        <IconButton
          testID="onboarding-back-button"
          icon="chevron-back"
          onPress={() => (step > 0 ? setStep(step - 1) : signOut().then(() => router.replace("/welcome")))}
        />
        <View style={s.progress}>
          {STEPS.map((label, i) => (
            <View key={label} style={[s.seg, i <= step && { backgroundColor: colors.brandPrimary }]} />
          ))}
        </View>
        <Text style={s.stepText}>
          {step + 1}/{STEPS.length}
        </Text>
      </View>

      <KeyboardAwareScrollView bottomOffset={100} keyboardShouldPersistTaps="handled" contentContainerStyle={s.body}>
        <Animated.View key={step} entering={FadeInRight.duration(280)} style={s.gap}>
          {step === 0 ? (
            <>
              <Text style={s.title}>When&apos;s your birthday?</Text>
              <Text style={s.sub}>You must be 18 or older. Only your age is shown on your profile.</Text>
              <View style={s.dobRow}>
                <View style={s.dobCell}>
                  <Field testID="dob-month-input" label="Month" value={month} onChangeText={(t) => setMonth(t.replace(/\D/g, "").slice(0, 2))} placeholder="MM" keyboardType="number-pad" maxLength={2} />
                </View>
                <View style={s.dobCell}>
                  <Field testID="dob-day-input" label="Day" value={day} onChangeText={(t) => setDay(t.replace(/\D/g, "").slice(0, 2))} placeholder="DD" keyboardType="number-pad" maxLength={2} />
                </View>
                <View style={[s.dobCell, { flex: 1.4 }]}>
                  <Field testID="dob-year-input" label="Year" value={year} onChangeText={(t) => setYear(t.replace(/\D/g, "").slice(0, 4))} placeholder="YYYY" keyboardType="number-pad" maxLength={4} />
                </View>
              </View>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <Text style={s.title}>I am a</Text>
              <View style={s.options}>
                {GENDERS.map((g) => (
                  <Pressable key={g.value} testID={`gender-option-${g.value}`} onPress={() => setGender(g.value)} style={[s.option, gender === g.value && s.optionOn]}>
                    <Text style={[s.optionText, gender === g.value && { color: colors.brandPrimary }]}>{g.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[s.title, { marginTop: spacing.lg }]}>Show me</Text>
              <View style={s.options}>
                {GENDERS.map((g) => (
                  <Pressable
                    key={g.value}
                    testID={`interested-option-${g.value}`}
                    onPress={() => toggle(interestedIn, g.value, setInterestedIn)}
                    style={[s.option, interestedIn.includes(g.value) && s.optionOn]}
                  >
                    <Text style={[s.optionText, interestedIn.includes(g.value) && { color: colors.brandPrimary }]}>{g.label === "Woman" ? "Women" : g.label === "Man" ? "Men" : "Non-binary people"}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[s.title, { marginTop: spacing.lg }]}>Looking for</Text>
              <Text style={s.sub}>Optional. Shown on your profile and used to suggest compatible people.</Text>
              <View style={s.chips}>
                {INTENTIONS.map((it) => (
                  <Chip key={it.value} testID={`intention-option-${it.value}`} label={it.label} selected={intention === it.value} onPress={() => setIntention(intention === it.value ? null : it.value)} />
                ))}
              </View>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <Text style={s.title}>Add your photos</Text>
              <Text style={s.sub}>Add at least 1 photo (up to 6). Clear photos of your face get more matches.</Text>
              <PhotoGrid />
            </>
          ) : null}

          {step === 3 ? (
            <>
              <Text style={s.title}>Show your personality</Text>
              <Field testID="onboarding-bio-input" label="Bio" value={bio} onChangeText={setBio} placeholder="What makes you, you?" multiline maxLength={500} style={s.bio} />
              <Field testID="onboarding-job-input" label="Job (optional)" value={job} onChangeText={setJob} placeholder="What do you do?" />
              <Field testID="onboarding-city-input" label="City (optional)" value={city} onChangeText={setCity} placeholder="Where are you based?" />
              <Text style={s.label}>Interests ({interests.length}/10)</Text>
              <View style={s.chips}>
                {INTEREST_OPTIONS.map((i) => (
                  <Chip key={i} testID={`interest-chip-${i}`} label={i} selected={interests.includes(i)} onPress={() => toggle(interests, i, setInterests, 10)} />
                ))}
              </View>
            </>
          ) : null}
        </Animated.View>
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ opened: 0, closed: 0 }}>
        <View style={[s.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          {error ? (
            <Text testID="onboarding-error" style={s.error}>
              {error}
            </Text>
          ) : null}
          <Button testID="onboarding-next-button" title={step === STEPS.length - 1 ? "Start meeting people" : "Continue"} loading={busy} onPress={next} />
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, gap: spacing.sm },
  progress: { flex: 1, flexDirection: "row", gap: spacing.xs },
  seg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: c.surfaceTertiary },
  stepText: { color: c.muted, fontSize: font.sm, fontWeight: "600", width: 36, textAlign: "center" },
  body: { padding: spacing.xl, paddingBottom: 140 },
  gap: { gap: spacing.lg },
  title: { color: c.onSurface, fontSize: 28, fontWeight: "800" },
  sub: { color: c.muted, fontSize: font.base, lineHeight: 20 },
  label: { color: c.onSurfaceTertiary, fontSize: font.base, fontWeight: "600" },
  dobRow: { flexDirection: "row", gap: spacing.md },
  dobCell: { flex: 1 },
  options: { gap: spacing.sm },
  option: { height: 56, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, justifyContent: "center", paddingHorizontal: spacing.lg },
  optionOn: { borderColor: c.brandPrimary, backgroundColor: c.brandPrimarySoft },
  optionText: { color: c.onSurface, fontSize: font.lg, fontWeight: "600" },
  bio: { minHeight: 96, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.divider, gap: spacing.sm },
  error: { color: c.error, fontSize: font.base, textAlign: "center" },
}));

// ScrollView kept imported for type parity with KeyboardAwareScrollView consumers
void ScrollView;
