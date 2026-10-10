"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { saveAvatarAction } from "@/app/profile/avatar/actions";
import { avatarAssetTypes, type AvatarConfig } from "@/lib/avatar-schema";
import { avatarPresets, isSameAvatar } from "@/lib/avatar-presets";
import { AvatarPreview } from "./AvatarPreview";

type AvatarBuilderProps = {
  initialAvatar: AvatarConfig;
  error?: string | null;
};

function SaveAvatarButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="public-button-primary w-full sm:w-auto" aria-live="polite">
      {pending ? "Сохраняем…" : "Сохранить аватар"}
    </button>
  );
}

export function AvatarBuilder({ initialAvatar, error }: AvatarBuilderProps) {
  const [avatar, setAvatar] = useState<AvatarConfig>(initialAvatar);
  const hasLegacyAvatar = !avatarPresets.some((preset) => isSameAvatar(preset.avatar, initialAvatar));

  return (
    <form action={saveAvatarAction} className="avatar-editor profile-surface profile-border rounded-lg border p-4 sm:p-6">
      {avatarAssetTypes.map((key) => <input key={key} type="hidden" name={key} value={avatar[key]} />)}
      <fieldset>
        <legend className="text-base font-bold">Выберите панду</legend>
        <p className="profile-muted mt-1 text-sm leading-5">Готовый образ для вашего профиля.</p>
        {hasLegacyAvatar ? (
          <label className="avatar-option mt-4 flex cursor-pointer items-center gap-3 rounded-lg border p-3" data-selected={isSameAvatar(avatar, initialAvatar)}>
            <input type="radio" name="avatar_preset" value="saved" checked={isSameAvatar(avatar, initialAvatar)} onChange={() => setAvatar(initialAvatar)} className="sr-only" />
            <span className="w-16 shrink-0"><AvatarPreview avatar={initialAvatar} size="tile" /></span>
            <span className="min-w-0 text-sm font-semibold">Ваш сохранённый образ<span className="profile-muted mt-1 block text-xs font-normal">Он останется, пока вы не выберете новую панду.</span></span>
          </label>
        ) : null}
        <div className="mt-4 grid grid-cols-2 gap-3 min-[360px]:grid-cols-3 sm:grid-cols-5">
          {avatarPresets.map((preset) => (
            <label key={preset.id} className="avatar-option min-w-0 cursor-pointer rounded-lg border p-2" data-selected={isSameAvatar(avatar, preset.avatar)}>
              <input type="radio" name="avatar_preset" value={preset.id} checked={isSameAvatar(avatar, preset.avatar)} onChange={() => setAvatar(preset.avatar)} className="sr-only" />
              <AvatarPreview avatar={preset.avatar} size="tile" />
              <span className="mt-2 block text-center text-xs font-semibold leading-4">{preset.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {error ? <p className="profile-error mt-4 rounded-lg border px-4 py-3 text-sm font-semibold" role="alert">{error}</p> : null}
      <div className="avatar-editor-footer profile-border mt-5 border-t pt-4"><SaveAvatarButton /></div>
    </form>
  );
}
