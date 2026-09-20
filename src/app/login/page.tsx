"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import BrandLogo from "@/components/BrandLogo";
import {
  getSupabaseSession,
  landingRoute,
  loginUser,
  pendingMfaFactor,
  verifyMfaCode,
} from "@/lib/auth";

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

type Errors = { email?: string; password?: string };

export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState("");
  // Hide the sign-up link when an admin has closed registration.
  const [signupOpen, setSignupOpen] = useState(true);
  useEffect(() => {
    fetch("/api/registration")
      .then((r) => r.json())
      .then((d) => setSignupOpen(d?.enabled !== false))
      .catch(() => {});
  }, []);
  // 2FA challenge step (shown after a correct password when the account has TOTP).
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaError, setMfaError] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);

  useEffect(() => {
    getSupabaseSession().then(async (s) => {
      if (!s) return;
      // A session at AAL1 with TOTP still needs the code — don't skip it on reload.
      const factorId = await pendingMfaFactor();
      if (factorId) {
        setMfaFactorId(factorId);
        return;
      }
      router.replace(await landingRoute());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validate = (fields = { email, password }): Errors => {
    const e: Errors = {};
    if (!fields.email.trim()) e.email = "Email is required";
    else if (!isValidEmail(fields.email)) e.email = "Enter a valid email address";
    if (!fields.password) e.password = "Password is required";
    return e;
  };

  const handleBlur = (field: string) => {
    setTouched((t) => ({ ...t, [field]: true }));
    setErrors(validate());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ email: true, password: true });
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    setServerError("");
    const result = await loginUser(email.trim(), password);
    setLoading(false);

    if (!result.success || !result.session) {
      setServerError(result.error ?? "Login failed");
      return;
    }

    // If 2FA is enabled, the session is only AAL1 — require a TOTP code next.
    const factorId = await pendingMfaFactor();
    if (factorId) {
      setMfaFactorId(factorId);
      return;
    }

    router.replace(await landingRoute());
  };

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaFactorId || mfaCode.length < 6) return;
    setMfaBusy(true);
    setMfaError("");
    const res = await verifyMfaCode(mfaFactorId, mfaCode);
    setMfaBusy(false);
    if ("error" in res) {
      setMfaError(res.error);
      return;
    }
    router.replace(await landingRoute());
  };

  const fieldClass = (field: keyof Errors, extra = "") =>
    `w-full py-2.5 text-[14px] border rounded-lg outline-none transition text-gray-700 placeholder-gray-400 ${extra} ${
      touched[field] && errors[field]
        ? "border-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-100"
        : "border-gray-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
    }`;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#e8ecf5] px-4">
      <BrandLogo />

      <h1 className="text-[20px] font-semibold text-gray-900 mb-1">
        {mfaFactorId ? "Two-step verification" : "Welcome back"}
      </h1>
      <p className="text-[14px] text-gray-500 mb-6">
        {mfaFactorId
          ? "Enter the 6-digit code from your authenticator app"
          : "Sign in to your account to continue"}
      </p>

      {mfaFactorId ? (
        <form
          onSubmit={handleVerifyMfa}
          className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 sm:p-8 w-full max-w-[400px]"
        >
          {mfaError && (
            <div className="mb-4 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-600 flex items-center gap-2">
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
              {mfaError}
            </div>
          )}
          <input
            value={mfaCode}
            onChange={(e) => {
              setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              if (mfaError) setMfaError("");
            }}
            inputMode="numeric"
            autoFocus
            placeholder="000000"
            className="w-full text-center tracking-[0.5em] text-[20px] font-semibold border border-gray-200 rounded-lg py-3 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 mb-4"
          />
          <button
            type="submit"
            disabled={mfaBusy || mfaCode.length < 6}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-medium text-[15px] py-2.5 rounded-lg flex items-center justify-center gap-2 transition mb-3"
          >
            {mfaBusy ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              "Verify"
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setMfaFactorId(null);
              setMfaCode("");
              setMfaError("");
            }}
            className="w-full text-[13px] text-gray-500 hover:text-gray-700 transition"
          >
            Back to sign in
          </button>
        </form>
      ) : (
        <form
          onSubmit={handleSubmit}
          noValidate
          className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 sm:p-8 w-full max-w-[400px]"
        >
          {serverError && (
            <div className="mb-4 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-600 flex items-center gap-2">
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
              {serverError}
            </div>
          )}

          {/* Email */}
          <div className="mb-4">
            <label className="block text-[13px] font-medium text-gray-700 mb-1.5">
              Email address
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <svg
                  width="16"
                  height="16"
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
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (serverError) setServerError("");
                }}
                onBlur={() => handleBlur("email")}
                placeholder="john@company.com"
                className={fieldClass("email", "pl-9 pr-4")}
              />
            </div>
            {touched.email && errors.email && (
              <p className="mt-1.5 text-[12px] text-red-500 flex items-center gap-1">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {errors.email}
              </p>
            )}
          </div>

          {/* Password */}
          <div className="mb-4">
            <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Password</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <svg
                  width="15"
                  height="15"
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
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (serverError) setServerError("");
                }}
                onBlur={() => handleBlur("password")}
                placeholder="Enter your password"
                className={fieldClass("password", "pl-9 pr-10")}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
              >
                {showPassword ? (
                  <svg
                    width="16"
                    height="16"
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
                    width="16"
                    height="16"
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
            {touched.password && errors.password && (
              <p className="mt-1.5 text-[12px] text-red-500 flex items-center gap-1">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {errors.password}
              </p>
            )}
          </div>

          {/* Remember me + Forgot */}
          <div className="flex items-center justify-between mb-5">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setRememberMe(!rememberMe)}
                className={`w-4 h-4 border rounded flex items-center justify-center ${
                  rememberMe ? "bg-emerald-600 border-emerald-600" : "border-gray-300 bg-white"
                }`}
              >
                {rememberMe && (
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2 6l3 3 5-5"
                      stroke="white"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
              <span className="text-[13px] text-gray-600">Remember me</span>
            </label>
            <Link
              href="/reset-password"
              className="text-[13px] text-emerald-600 hover:underline font-medium"
            >
              Forgot password?
            </Link>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-emerald-400 text-white font-medium text-[15px] py-2.5 rounded-lg flex items-center justify-center gap-2 transition mb-5"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                Sign in
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </>
            )}
          </button>

          {signupOpen && (
            <p className="text-center text-[13px] text-gray-500">
              Don&apos;t have an account?{" "}
              <Link href="/register" className="text-emerald-600 font-medium hover:underline">
                Sign up
              </Link>
            </p>
          )}
        </form>
      )}
    </div>
  );
}
