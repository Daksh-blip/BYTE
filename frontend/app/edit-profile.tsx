import { goBack } from "@/src/go-back";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { api, Me } from "@/src/api";
import { useAuth } from "@/src/auth";
import { AiBioHelper } from "@/src/components/ai-bio-helper";
import { GENDERS, INTEREST_OPTIONS, INTENTIONS, LANGUAGES, PROMPT_QUESTIONS } from "@/src/constants";
import { Sheet, SheetRow } from "@/src/components/sheet";
import { PhotoGrid } from "@/src/components/photo-grid";
import { ScreenHeader } from "@/src/components/screen-header";
import { Button, Chip, Field } from "@/src/components/ui";
import { useToast } from "@/src/components/toast";
import { makeStyles, useTheme, spacing, radius, font } from "@/src/theme";

function Stepper({ label, value, onChange, min, max, testID }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; testID: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  return (
    <View style={s.stepper}>
      <Text style={s.stepLabel}>{label}</Text>
      <View style={s.stepCtrls}>
        <Pressable testID={`${testID}-minus`} style={s.stepBtn} onPress={() => onChange(Math.max(min, value - 1))}>
          <Ionicons name="remove" size={18} color={colors.onSurface} />
        </Pressable>
        <Text testID={`${testID}-value`} style={s.stepValue}>
          {value}
        </Text>
        <Pressable testID={`${testID}-plus`} style={s.stepBtn} onPress={() => onChange(Math.min(max, value + 1))}>
          <Ionicons name="add" size={18} color={colors.onSurface} />
        </Pressable>
      </View>
    </View>
  );
}

export default function EditProfile() {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [job, setJob] = useState(user?.job ?? "");
  const [city, setCity] = useState(user?.city ?? "");
  const [interests, setInterests] = useState<string[]>(user?.interests ?? []);
  const [interestedIn, setInterestedIn] = useState<string[]>(user?.interested_in ?? []);
  const [ageMin, setAgeMin] = useState(user?.age_min ?? 18);
  const [ageMax, setAgeMax] = useState(user?.age_max ?? 60);
  const [busy, setBusy] = useState(false);
  const [intention, setIntention] = useState<string | null>(user?.intention ?? null);
  const [pronouns, setPronouns] = useState(user?.pronouns ?? "");
  const [languages, setLanguages] = useState<string[]>(user?.languages ?? []);
  const [prompts, setPrompts] = useState<{ question: string; answer: string }[]>(user?.prompts ?? []);
  const [pickingPrompt, setPickingPrompt] = useState(false);

  const toggle = (arr: string[], v: string, set: (a: string[]) => void, max = 99) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : arr.length >= max ? arr : [...arr, v]);

  const save = async () => {
    if (!interestedIn.length) return toast("Choose at least one group to see", "error");
    setBusy(true);
    try {
      const me = await api<Me>("/me", {
        method: "PUT",
        body: {
          name, bio: bio.trim(), job: job.trim(), city: city.trim(), interests, interested_in: interestedIn, age_min: ageMin, age_max: ageMax,
          pronouns: pronouns.trim(), languages, prompts: prompts.filter((p) => p.answer.trim()),
          ...(intention ? { intention } : {}),
        },
      });
      setUser(me);
      toast("Profile saved", "success");
      goBack("/profile");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root} testID="edit-profile-screen">
      <ScreenHeader title="Edit profile" />
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={[s.body, { paddingBottom: insets.bottom + spacing.xl }]}>
        <Text style={s.section}>Photos</Text>
        <PhotoGrid />
        <Text style={s.hint}>Tap a photo to make it your main photo or remove it.</Text>

        <Text style={s.section}>About you</Text>
        <Field testID="edit-name-input" label="First name" value={name} onChangeText={setName} maxLength={40} />
        <Field testID="edit-bio-input" label="Bio" value={bio} onChangeText={setBio} multiline maxLength={500} style={s.bio} placeholder="What makes you, you?" />
        <AiBioHelper draft={bio} onPick={setBio} />
        <Field testID="edit-job-input" label="Job" value={job} onChangeText={setJob} placeholder="What do you do?" />
        <Field testID="edit-city-input" label="City" value={city} onChangeText={setCity} placeholder="Where are you based?" />
        <Field testID="edit-pronouns-input" label="Pronouns (optional)" value={pronouns} onChangeText={setPronouns} placeholder="e.g. she/her" maxLength={20} />

        <Text style={s.section}>Looking for</Text>
        <View style={s.chips}>
          {INTENTIONS.map((it) => (
            <Chip key={it.value} testID={`edit-intention-${it.value}`} label={it.label} selected={intention === it.value} onPress={() => setIntention(it.value)} />
          ))}
        </View>

        <Text style={s.section}>Prompts ({prompts.length}/3)</Text>
        <Text style={s.hint}>Prompts give people an easy, thoughtful way to start a conversation.</Text>
        {prompts.map((p, idx) => (
          <View key={p.question} style={s.promptCard}>
            <View style={s.promptHead}>
              <Text style={s.promptQ}>{p.question}</Text>
              <Pressable testID={`edit-prompt-remove-${idx}`} hitSlop={10} onPress={() => setPrompts(prompts.filter((_, i) => i !== idx))}>
                <Ionicons name="close-circle" size={20} color={colors.muted} />
              </Pressable>
            </View>
            <TextInput
              testID={`edit-prompt-answer-${idx}`}
              value={p.answer}
              onChangeText={(t) => setPrompts(prompts.map((x, i) => (i === idx ? { ...x, answer: t } : x)))}
              placeholder="Your answer"
              placeholderTextColor={colors.muted}
              maxLength={200}
              multiline
              style={s.promptInput}
            />
          </View>
        ))}
        {prompts.length < 3 ? (
          <Button testID="edit-add-prompt" title="Add a prompt" icon="add" variant="secondary" onPress={() => setPickingPrompt(true)} />
        ) : null}

        <Text style={s.section}>Languages</Text>
        <View style={s.chips}>
          {LANGUAGES.map((l) => (
            <Chip key={l} testID={`edit-language-${l}`} label={l} selected={languages.includes(l)} onPress={() => toggle(languages, l, setLanguages, 5)} />
          ))}
        </View>

        <Text style={s.section}>Interests ({interests.length}/10)</Text>
        <View style={s.chips}>
          {INTEREST_OPTIONS.map((i) => (
            <Chip key={i} testID={`edit-interest-${i}`} label={i} selected={interests.includes(i)} onPress={() => toggle(interests, i, setInterests, 10)} />
          ))}
        </View>

        <Text style={s.section}>Discovery preferences</Text>
        <View style={s.chips}>
          {GENDERS.map((g) => (
            <Chip
              key={g.value}
              testID={`edit-show-${g.value}`}
              label={g.label === "Woman" ? "Women" : g.label === "Man" ? "Men" : "Non-binary"}
              selected={interestedIn.includes(g.value)}
              onPress={() => toggle(interestedIn, g.value, setInterestedIn)}
            />
          ))}
        </View>
        <View style={s.card}>
          <Stepper testID="edit-age-min" label="Minimum age" value={ageMin} min={18} max={ageMax} onChange={setAgeMin} />
          <View style={s.divider} />
          <Stepper testID="edit-age-max" label="Maximum age" value={ageMax} min={ageMin} max={99} onChange={setAgeMax} />
        </View>

        <Button testID="edit-save-button" title="Save changes" loading={busy} onPress={save} style={{ marginTop: spacing.lg }} />
      </KeyboardAwareScrollView>
      <Sheet visible={pickingPrompt} onClose={() => setPickingPrompt(false)} title="Pick a prompt" testID="prompt-picker-sheet">
        <ScrollView>
          {PROMPT_QUESTIONS.filter((q) => !prompts.some((p) => p.question === q)).map((q, i) => (
            <SheetRow
              key={q}
              testID={`prompt-option-${i}`}
              label={q}
              onPress={() => {
                setPrompts([...prompts, { question: q, answer: "" }]);
                setPickingPrompt(false);
              }}
            />
          ))}
        </ScrollView>
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  body: { padding: spacing.lg, gap: spacing.lg },
  section: { color: c.muted, fontSize: font.sm, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.md },
  hint: { color: c.muted, fontSize: font.sm },
  bio: { minHeight: 96, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.lg },
  divider: { height: 1, backgroundColor: c.divider },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 60 },
  stepLabel: { color: c.onSurface, fontSize: font.lg, fontWeight: "500" },
  stepCtrls: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  stepValue: { color: c.brandPrimary, fontSize: font.lg, fontWeight: "700", minWidth: 28, textAlign: "center" },
  promptCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm },
  promptHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  promptQ: { color: c.brandPrimary, fontSize: font.base, fontWeight: "700", flex: 1 },
  promptInput: { color: c.onSurface, fontSize: font.lg, minHeight: 44, textAlignVertical: "top" },
}));
