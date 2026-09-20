"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import BrandLogo from "@/components/BrandLogo";
import { sendPasswordResetEmail, verifyPasswordResetOtp } from "@/lib/auth";

const RESEND_TIMEOUT = 60;

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export default function ResetPasswordPage() {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [serverError, setServerError] = useState("");
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState(["", "", "", "", "", "", "", ""]);
  const [codeError, setCodeError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [countdown, setCountdown] = useState(RESEND_TIMEOUT);
  const [canResend, setCanResend] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const startTimer = useCallback(() => {
    setCanResend(false);
    setCountdown(RESEND_TIMEOUT);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          setCanResend(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const validateEmail = (value: string) => {
    if (!value.trim()) return "Email is required";
    if (!isValidEmail(value)) return "Enter a valid email address";
    return "";
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailTouched(true);
    const err = validateEmail(email);
    setEmailError(err);
    if (err) return;

    setLoading(true);
    setServerError("");
    const result = await sendPasswordResetEmail(email.trim());
    setLoading(false);

    if (!result.success) {
      setServerError(result.error ?? "Failed to send reset email");
      return;
    }

    setStep("code");
    startTimer();
  };

  const handleCodeChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const newCode = [...code];
    newCode[index] = digit;
    setCode(newCode);
    setCodeError("");
    if (digit && index < 7) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 8);
    const newCode = [...code];
    pasted.split("").forEach((char, i) => {
      newCode[i] = char;
    });
    setCode(newCode);
    const nextEmpty = newCode.findIndex((v) => !v);
    inputsRef.current[nextEmpty === -1 ? 7 : nextEmpty]?.focus();
  };

  const handleResend = async () => {
    if (!canResend) return;
    setCode(["", "", "", "", "", "", "", ""]);
    setCodeError("");
    setServerError("");
    inputsRef.current[0]?.focus();

    const result = await sendPasswordResetEmail(email.trim());
    if (!result.success) {
      setServerError(result.error ?? "Failed to resend");
      return;
    }
    startTimer();
  };

  const handleConfirmCode = async () => {
    const token = code.join("");
    if (token.length < 6) return;

    setVerifying(true);
    setCodeError("");
    const result = await verifyPasswordResetOtp(email.trim(), token);
    setVerifying(false);

    if (!result.success) {
      setCodeError(result.error ?? "Invalid code. Please try again.");
      setCode(["", "", "", "", "", "", "", ""]);
      inputsRef.current[0]?.focus();
      return;
    }

    window.location.href = "/profile";
  };

  const formatTime = (s: number) => `0:${s.toString().padStart(2, "0")}`;
  const isCodeComplete = code.every((d) => d !== "");

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#e8ecf5] px-4">
      <BrandLogo />

      {step === "email" ? (
        <>
          <h1 className="text-[20px] font-semibold text-gray-900 mb-1">Reset your password</h1>
          <p className="text-[14px] text-gray-500 mb-6 text-center">
            Enter your email and we&apos;ll send you a reset code
          </p>

          <form
            onSubmit={handleSendCode}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 sm:p-8 w-full max-w-100"
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
            <div className="mb-5">
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
                    if (emailTouched) setEmailError(validateEmail(e.target.value));
                    if (serverError) setServerError("");
                  }}
                  onBlur={() => {
                    setEmailTouched(true);
                    setEmailError(validateEmail(email));
                  }}
                  placeholder="john@company.com"
                  className={`w-full pl-9 pr-4 py-2.5 text-[14px] border rounded-lg outline-none transition text-gray-700 placeholder-gray-400 ${
                    emailTouched && emailError
                      ? "border-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-100"
                      : "border-gray-200 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  }`}
                />
              </div>
              {emailTouched && emailError && (
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
                  {emailError}
                </p>
              )}
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
                  Send reset code
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

            <p className="text-center text-[13px] text-gray-500">
              Remembered your password?{" "}
              <Link href="/login" className="text-emerald-600 font-medium hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </>
      ) : (
        <>
          <h1 className="text-[20px] font-semibold text-gray-900 mb-1">Check your email</h1>
          <p className="text-[14px] text-gray-500 mb-1 text-center">We sent a 6-digit code to</p>
          <p className="text-[14px] font-medium text-gray-800 mb-6">{email}</p>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 sm:p-8 w-full max-w-100">
            {(serverError || codeError) && (
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
                {codeError || serverError}
              </div>
            )}

            <div className="flex gap-1 sm:gap-1.5 justify-center mb-5" onPaste={handlePaste}>
              {code.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputsRef.current[i] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleCodeChange(i, e.target.value)}
                  onKeyDown={(e) => handleCodeKeyDown(i, e)}
                  className={`w-9 h-10 sm:w-10 sm:h-11 text-center text-[16px] sm:text-[18px] font-semibold border rounded-xl outline-none transition
                    ${digit ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-gray-200 text-gray-700"}
                    focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100`}
                />
              ))}
            </div>

            <div className="flex items-center justify-between mb-5 flex-wrap gap-1">
              <span className="text-[13px] text-gray-500">Didn&apos;t receive the code?</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleResend}
                  disabled={!canResend}
                  className={`text-[13px] font-medium transition ${
                    canResend
                      ? "text-emerald-600 hover:underline cursor-pointer"
                      : "text-gray-400 cursor-not-allowed"
                  }`}
                >
                  Resend
                </button>
                {!canResend && (
                  <span className="text-[13px] text-gray-400 tabular-nums">
                    ({formatTime(countdown)})
                  </span>
                )}
              </div>
            </div>

            <button
              disabled={!isCodeComplete || verifying}
              onClick={handleConfirmCode}
              className={`w-full font-medium text-[15px] py-2.5 rounded-lg flex items-center justify-center gap-2 transition mb-5 ${
                isCodeComplete && !verifying
                  ? "bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              }`}
            >
              {verifying ? (
                <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  Confirm code
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

            <p className="text-center text-[13px] text-gray-500">
              Wrong email?{" "}
              <button
                onClick={() => {
                  setStep("email");
                  setCode(["", "", "", "", "", ""]);
                  setCodeError("");
                  setServerError("");
                }}
                className="text-emerald-600 font-medium hover:underline"
              >
                Change it
              </button>
            </p>
          </div>
        </>
      )}
    </div>
  );
}
