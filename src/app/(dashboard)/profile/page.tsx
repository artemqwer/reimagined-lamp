"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase";
import {
  logoutUser,
  listVerifiedTotp,
  startMfaEnroll,
  verifyMfaCode,
  disableMfa,
} from "@/lib/auth";
import { useRouter } from "next/navigation";

// ─── Sub-components (must be outside the page function) ──────────────────────

function Msg({ msg }: { msg: { type: "success" | "error"; text: string } | null }) {
  if (!msg) return null;
  return (
    <div
      className={`mb-4 px-3 py-2.5 rounded-lg text-[13px] flex items-center gap-2 ${msg.type === "success" ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-600"}`}
    >
      {msg.type === "success" ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      )}
      {msg.text}
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [profileLoading, setProfileLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );
  const [passwordMsg, setPasswordMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [avatarMsg, setAvatarMsg] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );

  // ── Two-Factor (TOTP) ──
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null); // verified → 2FA on
  const [mfaEnrolling, setMfaEnrolling] = useState<{
    factorId: string;
    qr: string;
    secret: string;
  } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaMsg, setMfaMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [mfaDisableConfirm, setMfaDisableConfirm] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        const meta = data.user.user_metadata ?? {};
        const full: string = meta.full_name ?? "";
        const parts = full.trim().split(" ");
        setFirstName(parts[0] ?? "");
        setLastName(parts.slice(1).join(" "));
        setEmail(data.user.email ?? "");
        setPhone(meta.phone ?? "");
        setLocation(meta.location ?? "");
        setAvatarUrl(meta.avatar_url ?? null);
      }
    });
  }, []);

  // Reflect current 2FA status.
  useEffect(() => {
    listVerifiedTotp()
      .then((list) => setMfaFactorId(list[0]?.id ?? null))
      .catch(() => {});
  }, []);

  const handleStartMfa = async () => {
    setMfaBusy(true);
    setMfaMsg(null);
    const res = await startMfaEnroll();
    setMfaBusy(false);
    if ("error" in res) {
      setMfaMsg({ type: "error", text: res.error });
      return;
    }
    setMfaEnrolling({ factorId: res.factorId, qr: res.qr, secret: res.secret });
    setMfaCode("");
  };

  const handleVerifyMfa = async () => {
    if (!mfaEnrolling || mfaCode.trim().length < 6) return;
    setMfaBusy(true);
    setMfaMsg(null);
    const res = await verifyMfaCode(mfaEnrolling.factorId, mfaCode);
    setMfaBusy(false);
    if ("error" in res) {
      setMfaMsg({ type: "error", text: res.error });
      return;
    }
    setMfaFactorId(mfaEnrolling.factorId);
    setMfaEnrolling(null);
    setMfaCode("");
    setMfaMsg({ type: "success", text: "Two-factor authentication enabled" });
    setTimeout(() => setMfaMsg(null), 4000);
  };

  const handleCancelMfaEnroll = async () => {
    if (mfaEnrolling) await disableMfa(mfaEnrolling.factorId); // drop the unverified factor
    setMfaEnrolling(null);
    setMfaCode("");
    setMfaMsg(null);
  };

  const handleDisableMfa = async () => {
    if (!mfaFactorId) return;
    setMfaBusy(true);
    setMfaMsg(null);
    const res = await disableMfa(mfaFactorId);
    setMfaBusy(false);
    setMfaDisableConfirm(false);
    if ("error" in res) {
      setMfaMsg({ type: "error", text: res.error });
      return;
    }
    setMfaFactorId(null);
    setMfaMsg({ type: "success", text: "Two-factor authentication disabled" });
    setTimeout(() => setMfaMsg(null), 4000);
  };

  const initials =
    `${firstName.slice(0, 1)}${lastName.slice(0, 1)}`.toUpperCase() ||
    email.slice(0, 2).toUpperCase();
  const displayAvatar = avatarPreview ?? avatarUrl;

  const processFile = async (file: File) => {
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type)) {
      setAvatarMsg({ type: "error", text: "Only JPG, PNG, GIF or WebP allowed" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setAvatarMsg({ type: "error", text: "File must be under 2MB" });
      return;
    }
    const preview = URL.createObjectURL(file);
    setAvatarPreview(preview);
    setAvatarMsg(null);
    setAvatarLoading(true);

    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id ?? "unknown";
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${uid}/avatar.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true });
    if (upErr) {
      setAvatarLoading(false);
      setAvatarPreview(null);
      setAvatarMsg({ type: "error", text: "Upload failed: " + upErr.message });
      return;
    }
    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
    const url = urlData.publicUrl + `?t=${Date.now()}`;
    await supabase.auth.updateUser({ data: { avatar_url: url } });
    setAvatarUrl(url);
    setAvatarPreview(null);
    setAvatarLoading(false);
    setAvatarMsg({ type: "success", text: "Photo updated" });
    setTimeout(() => setAvatarMsg(null), 3000);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await processFile(file);
    e.target.value = "";
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await processFile(file);
  };

  const handleRemoveAvatar = async () => {
    const supabase = createClient();
    await supabase.auth.updateUser({ data: { avatar_url: null } });
    setAvatarUrl(null);
    setAvatarPreview(null);
    setAvatarMsg({ type: "success", text: "Photo removed" });
    setTimeout(() => setAvatarMsg(null), 2000);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileLoading(true);
    setProfileMsg(null);
    const full_name = `${firstName.trim()} ${lastName.trim()}`.trim();
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({
      data: { full_name, phone: phone.trim(), location: location.trim() },
    });
    setProfileLoading(false);
    if (error) {
      setProfileMsg({ type: "error", text: error.message });
    } else {
      setProfileMsg({ type: "success", text: "Profile updated successfully" });
      setTimeout(() => setProfileMsg(null), 3000);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword) {
      setPasswordMsg({ type: "error", text: "New password is required" });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordMsg({ type: "error", text: "Password must be at least 8 characters" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "error", text: "Passwords do not match" });
      return;
    }
    setPasswordLoading(true);
    setPasswordMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordLoading(false);
    if (error) {
      setPasswordMsg({ type: "error", text: error.message });
    } else {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMsg({ type: "success", text: "Password changed successfully" });
      setTimeout(() => setPasswordMsg(null), 3000);
    }
  };

  const handleDeleteAccount = async () => {
    await logoutUser();
    router.replace("/login");
  };

  return (
    <div className="p-4 sm:p-6 max-w-[896px] mx-auto">
      <h1 className="text-[30px] leading-[36px] font-bold text-[#101828] mb-2">Profile Settings</h1>
      <p className="text-[16px] text-[#4a5565] mb-8">
        Manage your personal information and account security
      </p>

      {/* ── Profile Photo ── */}
      <div className="bg-white rounded-[14px] border border-[#e5e7eb] p-6 mb-6">
        <p className="text-[16px] font-semibold text-[#101828] mb-6">Profile Photo</p>
        <div className="flex items-start gap-6">
          {/* Drop zone avatar */}
          <div
            className={`relative shrink-0 cursor-pointer rounded-full transition ${dragOver ? "ring-2 ring-emerald-400 ring-offset-2" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div
              className="w-24 h-24 rounded-full flex items-center justify-center text-white text-[30px] leading-[36px] font-medium overflow-hidden"
              style={{ background: "linear-gradient(135deg,#8e51ff,#9810fa)" }}
            >
              {avatarLoading ? (
                <div
                  className="w-full h-full flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg,#8e51ff,#9810fa)" }}
                >
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              ) : displayAvatar ? (
                <img src={displayAvatar} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div className="absolute bottom-0 right-0 w-8 h-8 bg-[#059669] rounded-full flex items-center justify-center shadow hover:bg-emerald-700 transition border-2 border-white">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={handleAvatarUpload}
            />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-[16px] font-semibold text-[#101828] truncate">
              {`${firstName} ${lastName}`.trim() || email}
            </p>
            <p className="text-[14px] text-[#4a5565] mt-1">JPG, PNG or GIF. Max size of 2MB</p>
            <div className="flex items-center gap-3 mt-4 flex-wrap">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarLoading}
                className="text-[14px] px-4 h-[37px] bg-[#059669] hover:bg-emerald-700 disabled:bg-emerald-400 text-white rounded-[10px] transition"
              >
                Upload new photo
              </button>
              {(avatarUrl || avatarPreview) && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  className="text-[14px] px-4 h-[37px] border border-[#d1d5dc] text-[#364153] hover:bg-gray-50 rounded-[10px] transition"
                >
                  Remove
                </button>
              )}
            </div>
            {avatarMsg && (
              <p
                className={`mt-2 text-[12px] ${avatarMsg.type === "success" ? "text-green-600" : "text-red-500"}`}
              >
                {avatarMsg.text}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Personal Information ── */}
      <div className="bg-white rounded-[14px] border border-[#e5e7eb] p-6 mb-6">
        <p className="text-[16px] font-semibold text-[#101828] mb-6">Personal Information</p>
        <form onSubmit={handleSaveProfile}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block text-[14px] text-[#364153] mb-2">First Name</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" />
                  </svg>
                </span>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="John"
                  className="w-full h-11 pl-10 pr-4 text-[16px] border border-[#d1d5dc] rounded-[10px] outline-none transition text-[#0a0a0a] placeholder-[#9ca3af] focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                />
              </div>
            </div>
            <div>
              <label className="block text-[14px] text-[#364153] mb-2">Last Name</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" />
                  </svg>
                </span>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                  className="w-full h-11 pl-10 pr-4 text-[16px] border border-[#d1d5dc] rounded-[10px] outline-none transition text-[#0a0a0a] placeholder-[#9ca3af] focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block text-[14px] text-[#364153] mb-2">Email</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="m2 7 10 7 10-7" />
                  </svg>
                </span>
                <input
                  type="email"
                  value={email}
                  disabled
                  className="w-full h-11 pl-10 pr-4 text-[16px] border border-[#e5e7eb] rounded-[10px] outline-none bg-gray-50 text-gray-400 cursor-not-allowed"
                />
              </div>
            </div>
            <div>
              <label className="block text-[14px] text-[#364153] mb-2">Phone</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4a2 2 0 0 1 1.98-2.18h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6.29 6.29l.87-.87a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (555) 123-4567"
                  className="w-full h-11 pl-10 pr-4 text-[16px] border border-[#d1d5dc] rounded-[10px] outline-none transition text-[#0a0a0a] placeholder-[#9ca3af] focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                />
              </div>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-[14px] text-[#364153] mb-2">Location</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </span>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="New York, USA"
                className="w-full h-11 pl-10 pr-4 text-[16px] border border-[#d1d5dc] rounded-[10px] outline-none transition text-[#0a0a0a] placeholder-[#9ca3af] focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />
            </div>
          </div>

          <Msg msg={profileMsg} />

          <div className="flex justify-start md:justify-end">
            <button
              type="submit"
              disabled={profileLoading}
              className="bg-[#059669] hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-[16px] px-5 h-11 rounded-[10px] flex items-center gap-2 transition"
            >
              {profileLoading && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              Save Changes
            </button>
          </div>
        </form>
      </div>

      {/* ── Security ── */}
      <div className="bg-white rounded-[14px] border border-[#e5e7eb] p-6 mb-6">
        <p className="text-[16px] font-semibold text-[#101828] mb-6">Security</p>
        <form onSubmit={handleChangePassword}>
          {[
            {
              label: "Current Password",
              placeholder: "Enter current password",
              value: currentPassword,
              set: setCurrentPassword,
              show: showCurrent,
              toggle: () => setShowCurrent(!showCurrent),
            },
            {
              label: "New Password",
              placeholder: "Enter new password",
              value: newPassword,
              set: setNewPassword,
              show: showNew,
              toggle: () => setShowNew(!showNew),
            },
            {
              label: "Confirm New Password",
              placeholder: "Confirm new password",
              value: confirmPassword,
              set: setConfirmPassword,
              show: showConfirm,
              toggle: () => setShowConfirm(!showConfirm),
            },
          ].map(({ label, placeholder, value, set, show, toggle }) => (
            <div key={label} className="mb-6 last:mb-0">
              <label className="block text-[14px] text-[#364153] mb-2">{label}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </span>
                <input
                  type={show ? "text" : "password"}
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  placeholder={placeholder}
                  className="w-full h-11 pl-10 pr-11 text-[16px] border border-[#d1d5dc] rounded-[10px] outline-none transition text-[#0a0a0a] placeholder-[#9ca3af] focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                />
                <button
                  type="button"
                  onClick={toggle}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9ca3af] hover:text-gray-500 transition"
                >
                  {show ? (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          ))}

          <Msg msg={passwordMsg} />

          <div className="flex justify-start md:justify-end mt-6">
            <button
              type="submit"
              disabled={passwordLoading}
              className="bg-[#059669] hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-[16px] px-5 h-11 rounded-[10px] flex items-center gap-2 transition"
            >
              {passwordLoading && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              Update Password
            </button>
          </div>
        </form>
      </div>

      {/* ── Two-Factor Authentication ── */}
      <div className="bg-white rounded-[14px] border border-[#e5e7eb] p-6 mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-[10px] bg-[#dbeafe] text-[#059669] flex items-center justify-center shrink-0">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-[16px] font-semibold text-[#101828] flex items-center gap-2">
                Two-Factor Authentication
                {mfaFactorId && (
                  <span className="text-[11px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
                    Enabled
                  </span>
                )}
              </p>
              <p className="text-[14px] text-[#4a5565]">
                {mfaFactorId
                  ? "Your account is protected by an authenticator app"
                  : "Add an extra layer of security with an authenticator app"}
              </p>
            </div>
          </div>
          {mfaFactorId ? (
            mfaDisableConfirm ? (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setMfaDisableConfirm(false)}
                  className="text-[14px] px-3 h-9 border border-[#d1d5dc] text-[#364153] hover:bg-gray-50 rounded-[10px] transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDisableMfa}
                  disabled={mfaBusy}
                  className="text-[14px] px-4 h-9 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-[10px] transition flex items-center gap-1.5"
                >
                  {mfaBusy && (
                    <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  )}
                  Disable
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setMfaDisableConfirm(true)}
                className="shrink-0 text-[14px] px-4 h-9 border border-red-200 text-red-600 hover:bg-red-50 rounded-[10px] transition"
              >
                Disable 2FA
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={handleStartMfa}
              disabled={mfaBusy}
              className="shrink-0 text-[14px] px-4 h-9 bg-[#059669] hover:bg-emerald-700 disabled:opacity-50 text-white rounded-[10px] transition flex items-center gap-1.5"
            >
              {mfaBusy && !mfaEnrolling && (
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              Enable 2FA
            </button>
          )}
        </div>
        {mfaMsg && !mfaEnrolling && (
          <p
            className={`mt-3 text-[12px] ${mfaMsg.type === "success" ? "text-green-600" : "text-red-500"}`}
          >
            {mfaMsg.text}
          </p>
        )}
      </div>

      {/* ── 2FA enrollment modal ── */}
      {mfaEnrolling && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={handleCancelMfaEnroll}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-[400px] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[16px] font-bold text-gray-900 mb-1">
              Set up Two-Factor Authentication
            </h2>
            <p className="text-[12px] text-gray-500 mb-4">
              Scan the QR code with an authenticator app (Google Authenticator, Authy, 1Password…),
              then enter the 6-digit code.
            </p>
            <div className="flex justify-center mb-3">
              {/* Supabase returns the QR as an SVG (data URL or raw markup). */}
              {mfaEnrolling.qr.trim().startsWith("<svg") ? (
                <div
                  className="w-44 h-44 [&>svg]:w-full [&>svg]:h-full border border-gray-200 rounded-xl p-2"
                  dangerouslySetInnerHTML={{ __html: mfaEnrolling.qr }}
                />
              ) : (
                <img
                  src={mfaEnrolling.qr}
                  alt="2FA QR code"
                  className="w-44 h-44 border border-gray-200 rounded-xl p-2"
                />
              )}
            </div>
            <p className="text-[11px] text-gray-400 text-center mb-1">
              Can&apos;t scan? Enter this key manually:
            </p>
            <p className="text-[12px] font-mono text-gray-700 text-center bg-gray-50 border border-gray-100 rounded-lg py-1.5 mb-4 break-all select-all">
              {mfaEnrolling.secret}
            </p>
            <input
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleVerifyMfa();
              }}
              inputMode="numeric"
              placeholder="000000"
              autoFocus
              className="w-full text-center tracking-[0.5em] text-[18px] font-semibold border border-gray-200 rounded-xl py-2.5 outline-none focus:border-emerald-400 mb-2"
            />
            {mfaMsg && (
              <p
                className={`text-[12px] mb-2 ${mfaMsg.type === "success" ? "text-green-600" : "text-red-500"}`}
              >
                {mfaMsg.text}
              </p>
            )}
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={handleCancelMfaEnroll}
                className="flex-1 text-[13px] font-medium border border-gray-200 text-gray-600 py-2 rounded-xl hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleVerifyMfa}
                disabled={mfaBusy || mfaCode.length < 6}
                className="flex-1 text-[13px] font-medium bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-2 rounded-xl transition flex items-center justify-center gap-1.5"
              >
                {mfaBusy && (
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                Verify &amp; enable
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Danger Zone ── */}
      <div className="bg-white rounded-[14px] border border-red-100 p-6">
        <p className="text-[14px] font-semibold text-red-600 mb-1">Danger Zone</p>
        <p className="text-[12px] text-gray-400 mb-4">
          These actions are irreversible. Please be careful.
        </p>
        {!deleteConfirm ? (
          <button
            type="button"
            onClick={() => setDeleteConfirm(true)}
            className="text-[13px] font-medium px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg transition"
          >
            Delete account
          </button>
        ) : (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-[13px] font-medium text-red-700 mb-3">
              Are you sure? This will permanently delete your account and all data.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleDeleteAccount}
                className="text-[13px] font-medium px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition"
              >
                Yes, delete account
              </button>
              <button
                type="button"
                onClick={() => setDeleteConfirm(false)}
                className="text-[13px] font-medium px-4 py-2 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
