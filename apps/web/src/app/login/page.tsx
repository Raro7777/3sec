"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail, ArrowRight, ShieldCheck, Loader2, User } from "lucide-react";
import { motion } from "framer-motion";
import axios from "axios";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [name, setName] = useState("");
    const [isSignUp, setIsSignUp] = useState(false);
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const router = useRouter();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setIsLoading(true);

        try {
            const endpoint = isSignUp ? "/api/auth/register" : "/api/auth/login";
            const payload = isSignUp ? { email, password, name } : { email, password };
            
            const res = await axios.post(endpoint, payload);
            if (res.data.success) {
                // Determine routing based on role
                if (res.data.user.role === 'ADMIN') {
                    router.push("/admin");
                } else {
                    router.push("/");
                }
            }
        } catch (err: any) {
            setError(err.response?.data?.error || (isSignUp ? "회원가입 중 오류가 발생했습니다." : "로그인 중 오류가 발생했습니다."));
        } finally {
            setIsLoading(false);
        }
    };

    const handleTestLogin = async () => {
        setError("");
        setIsLoading(true);

        try {
            const res = await axios.post("/api/auth/test-login");
            if (res.data.success) {
                router.push("/");
            }
        } catch (err: any) {
            setError(err.response?.data?.error || "테스트 계정 로그인 중 오류가 발생했습니다.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-4">
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-500/10 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[120px]" />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md bg-zinc-900/50 backdrop-blur-xl border border-zinc-800 p-8 rounded-[2.5rem] shadow-2xl relative z-10"
            >
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-gradient-to-tr from-indigo-600 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/20">
                        <ShieldCheck className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-black text-white tracking-tight">3sec Workspace</h1>
                    <p className="text-zinc-500 text-sm mt-1">{isSignUp ? "새로운 계정을 생성해 주세요" : "사내 계정으로 로그인해 주세요"}</p>
                </div>

                <div className="mb-8 space-y-3 bg-zinc-800/30 p-5 rounded-2xl border border-zinc-800/50">
                    <div className="flex items-start gap-3">
                        <div className="min-w-4 mt-0.5 flex justify-center"><div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1"/></div>
                        <p className="text-sm text-zinc-300 leading-relaxed">단순회원 가입 시 <span className="text-white font-bold">승인 없이 바로 사용 가능</span></p>
                    </div>
                    <div className="flex items-start gap-3">
                        <div className="min-w-4 mt-0.5 flex justify-center"><div className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-1"/></div>
                        <p className="text-sm text-zinc-300 leading-relaxed">카드 영수증 사진을 찍으면 <span className="text-white font-bold">1초 만에 인식하고 저장·관리</span></p>
                    </div>
                    <div className="flex items-start gap-3">
                        <div className="min-w-4 mt-0.5 flex justify-center"><div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1"/></div>
                        <p className="text-sm text-zinc-300 leading-relaxed"><span className="text-white font-bold">회계 및 증빙 자료 제출용</span>으로 완벽 대응</p>
                    </div>
                    <div className="flex items-start gap-3">
                        <div className="min-w-4 mt-0.5 flex justify-center"><ShieldCheck className="w-4 h-4 text-green-400 mt-[2px]"/></div>
                        <p className="text-sm text-green-400 font-bold leading-relaxed">모든 업로드 자료는 안전하게 암호화 보관됨</p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-4">
                        {isSignUp && (
                            <div className="relative">
                                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                                <input
                                    type="text"
                                    placeholder="이름"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full pl-12 pr-4 py-4 bg-zinc-800/50 border border-zinc-700/50 rounded-2xl text-white outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                                    required={isSignUp}
                                />
                            </div>
                        )}
                        <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                            <input
                                type="text"
                                placeholder="아이디(이메일)"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full pl-12 pr-4 py-4 bg-zinc-800/50 border border-zinc-700/50 rounded-2xl text-white outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                                required
                            />
                        </div>
                        <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                            <input
                                type="password"
                                placeholder="비밀번호"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full pl-12 pr-4 py-4 bg-zinc-800/50 border border-zinc-700/50 rounded-2xl text-white outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                                required
                            />
                        </div>
                    </div>

                    {isSignUp && (
                        <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-xl p-4 text-xs text-zinc-400">
                            <strong>※ 개인정보 처리방침 안내</strong><br/>
                            입력하신 정보는 오직 영수증 사용 내역을 격리하고 분류하는 용도로만 사용됩니다. 다른 곳에 절대 제공되거나 활용되지 않으며, 서비스 이용에 필요한 최소한의 정보만 요청합니다.
                        </div>
                    )}

                    {error && (
                        <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="bg-red-500/10 border border-red-500/20 text-red-400 py-3 px-4 rounded-xl text-xs font-bold text-center"
                        >
                            {error}
                        </motion.p>
                    )}

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full py-4 bg-white text-black rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-zinc-200 transition-all active:scale-[0.98] shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <>{isSignUp ? "가입하기" : "로그인"} <ArrowRight className="w-5 h-5" /></>
                        )}
                    </button>
                    {!isSignUp && (
                        <button
                            type="button"
                            onClick={handleTestLogin}
                            disabled={isLoading}
                            className="w-full py-4 bg-zinc-800/80 border border-zinc-700 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-zinc-700 transition-all active:scale-[0.98] shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            체험용 테스트 계정으로 로그인 (가입 없음)
                        </button>
                    )}
                </form>

                <div className="mt-6 text-center">
                    <button 
                        onClick={() => { setIsSignUp(!isSignUp); setError(""); }}
                        className="text-indigo-400 hover:text-indigo-300 text-sm font-bold transition-colors"
                    >
                        {isSignUp ? "이미 계정이 있으신가요? 로그인" : "계정이 없으신가요? 가입하기"}
                    </button>
                </div>

                <p className="mt-8 text-center text-zinc-600 text-xs font-medium">
                    Secured by 3sec Infrastructure
                </p>
            </motion.div>
        </div>
    );
}
