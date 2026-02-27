import Link from "next/link";
import { Users, FileText, Settings, LogOut, ArrowLeft } from "lucide-react";
import LogoutButton from "./logout-button";

export default function AdminDashboardPage() {
    return (
        <div className="min-h-screen bg-[#09090b] text-white p-6 md:p-12">
            <header className="max-w-6xl mx-auto flex items-center justify-between mb-12">
                <div>
                    <h1 className="text-3xl font-black flex items-center gap-3">
                        3sec <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-orange-500">Admin</span>
                    </h1>
                    <p className="text-zinc-500 mt-2 text-sm">시스템 통합 관리자 대시보드</p>
                </div>
                <div className="flex items-center gap-4">
                    <Link href="/" className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-sm font-bold rounded-xl transition-colors flex items-center gap-2">
                        <ArrowLeft className="w-4 h-4" /> 앱으로 돌아가기
                    </Link>
                    <LogoutButton className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 text-sm font-bold rounded-xl transition-colors flex items-center gap-2" />
                </div>
            </header>

            <main className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
                    <div className="w-12 h-12 bg-indigo-500/10 text-indigo-500 rounded-2xl flex items-center justify-center mb-4">
                        <Users className="w-6 h-6" />
                    </div>
                    <h3 className="font-bold text-lg">사용자 관리</h3>
                    <p className="text-zinc-500 text-sm mt-2">사내 계정 추가 및 역할 수정</p>
                    <button className="mt-4 text-indigo-400 text-sm font-bold hover:underline">관리하기 &rarr;</button>
                </div>

                <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
                    <div className="w-12 h-12 bg-green-500/10 text-green-500 rounded-2xl flex items-center justify-center mb-4">
                        <FileText className="w-6 h-6" />
                    </div>
                    <h3 className="font-bold text-lg">전사 영수증 감사</h3>
                    <p className="text-zinc-500 text-sm mt-2">제출된 모든 내역 무효화 및 강제 승인</p>
                    <button className="mt-4 text-green-400 text-sm font-bold hover:underline">검토하기 &rarr;</button>
                </div>

                <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6">
                    <div className="w-12 h-12 bg-zinc-800 text-zinc-400 rounded-2xl flex items-center justify-center mb-4">
                        <Settings className="w-6 h-6" />
                    </div>
                    <h3 className="font-bold text-lg">시스템 설정</h3>
                    <p className="text-zinc-500 text-sm mt-2">OCR 모델 조정 및 데이터 백업</p>
                    <button className="mt-4 text-zinc-400 text-sm font-bold hover:underline">설정하기 &rarr;</button>
                </div>
            </main>
        </div>
    );
}
