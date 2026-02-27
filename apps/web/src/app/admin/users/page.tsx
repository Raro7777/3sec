"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Plus, Edit2, Trash2, Key, Shield, User as UserIcon, Loader2 } from "lucide-react";
import Link from "next/link";
import axios from "axios";

interface User {
    id: string;
    email: string;
    name: string | null;
    role: string;
    createdAt: string;
    company: { name: string } | null;
}

export default function AdminUsersPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [createForm, setCreateForm] = useState({ email: "", password: "", name: "", role: "EMPLOYEE" });
    const [createLoading, setCreateLoading] = useState(false);

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const res = await axios.get("/api/admin/users");
            setUsers(res.data);
        } catch (error) {
            console.error(error);
            alert("사용자 목록을 불러오지 못했습니다.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setCreateLoading(true);
        try {
            await axios.post("/api/admin/users", createForm);
            setIsCreateModalOpen(false);
            setCreateForm({ email: "", password: "", name: "", role: "EMPLOYEE" });
            fetchUsers();
        } catch (error: any) {
            alert(error.response?.data?.error || "사용자 생성 실패");
        } finally {
            setCreateLoading(false);
        }
    };

    const handleDeleteUser = async (id: string) => {
        if (!confirm("정말 이 사용자를 삭제하시겠습니까? 관련 데이터 삭제 처리가 필요할 수 있습니다.")) return;
        try {
            await axios.delete(`/api/admin/users/${id}`);
            setUsers(users.filter(u => u.id !== id));
        } catch (error: any) {
            alert(error.response?.data?.error || "삭제 실패");
        }
    };

    const handlePromoteAdmin = async (id: string, currentRole: string) => {
        const newRole = currentRole === "ADMIN" ? "EMPLOYEE" : "ADMIN";
        const action = currentRole === "ADMIN" ? "일반 직원으로 강등" : "관리자로 승급";
        
        if (!confirm(`이 사용자를 ${action}하시겠습니까?`)) return;

        try {
            await axios.patch(`/api/admin/users/${id}`, { role: newRole });
            setUsers(users.map(u => u.id === id ? { ...u, role: newRole } : u));
        } catch (error: any) {
            alert(error.response?.data?.error || "권한 변경 실패");
        }
    };

    return (
        <div className="min-h-screen bg-[#09090b] text-white p-6 md:p-12">
            <header className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-12">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <Link href="/admin" className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-full transition-colors">
                            <ArrowLeft className="w-4 h-4" />
                        </Link>
                        <h1 className="text-3xl font-black">사용자 관리</h1>
                    </div>
                    <p className="text-zinc-500 text-sm">시스템 계정을 추가하고 권한을 관리합니다.</p>
                </div>
                <button 
                    onClick={() => setIsCreateModalOpen(true)}
                    className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                    <Plus className="w-4 h-4" /> 새 사용자 구글
                </button>
            </header>

            <main className="max-w-6xl mx-auto">
                {loading ? (
                    <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>
                ) : (
                    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-zinc-800/50 text-zinc-400">
                                    <tr>
                                        <th className="p-4 font-bold">사용자 (Email)</th>
                                        <th className="p-4 font-bold hidden md:table-cell">이름</th>
                                        <th className="p-4 font-bold">권한</th>
                                        <th className="p-4 font-bold hidden sm:table-cell">가입일</th>
                                        <th className="p-4 font-bold text-right">옵션</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-800">
                                    {users.map(user => (
                                        <tr key={user.id} className="hover:bg-zinc-800/30 transition-colors">
                                            <td className="p-4 font-medium flex items-center gap-3">
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${user.role === 'ADMIN' ? 'bg-red-500/10 text-red-500' : 'bg-indigo-500/10 text-indigo-400'}`}>
                                                    {user.email.charAt(0).toUpperCase()}
                                                </div>
                                                {user.email}
                                            </td>
                                            <td className="p-4 text-zinc-400 hidden md:table-cell">{user.name || '-'}</td>
                                            <td className="p-4">
                                                <span className={`px-2 py-1 rounded-md text-xs font-bold ${user.role === 'ADMIN' ? 'bg-red-500/20 text-red-400' : 'bg-zinc-800 text-zinc-400'}`}>
                                                    {user.role}
                                                </span>
                                            </td>
                                            <td className="p-4 text-zinc-500 hidden sm:table-cell">
                                                {new Date(user.createdAt).toLocaleDateString()}
                                            </td>
                                            <td className="p-4 text-right space-x-2">
                                                <button 
                                                    onClick={() => handlePromoteAdmin(user.id, user.role)}
                                                    className="p-2 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg transition-colors"
                                                    title="권한 변경"
                                                >
                                                    <Shield className="w-4 h-4" />
                                                </button>
                                                <button 
                                                    onClick={() => handleDeleteUser(user.id)}
                                                    className="p-2 hover:bg-red-500/20 text-zinc-400 hover:text-red-400 rounded-lg transition-colors"
                                                    title="삭제"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {users.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="p-8 text-center text-zinc-500">
                                                사용자가 없습니다.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </main>

            {/* Create Modal */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-zinc-900 border border-zinc-800 w-full max-w-md p-6 rounded-3xl shadow-2xl">
                        <h2 className="text-xl font-bold mb-4">새 사용자 추가</h2>
                        <form onSubmit={handleCreateUser} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-zinc-400 mb-1">아이디 / 이메일 *</label>
                                <input 
                                    type="text" 
                                    required
                                    value={createForm.email}
                                    onChange={(e) => setCreateForm({...createForm, email: e.target.value})}
                                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition-colors"
                                    placeholder="user@3sec.app"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-zinc-400 mb-1">초기 비밀번호 *</label>
                                <div className="relative">
                                    <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                    <input 
                                        type="password" 
                                        required
                                        value={createForm.password}
                                        onChange={(e) => setCreateForm({...createForm, password: e.target.value})}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-xl pl-10 pr-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition-colors"
                                        placeholder="••••••••"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-zinc-400 mb-1">이름 (선택)</label>
                                    <input 
                                        type="text" 
                                        value={createForm.name}
                                        onChange={(e) => setCreateForm({...createForm, name: e.target.value})}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-zinc-400 mb-1">권한</label>
                                    <select 
                                        value={createForm.role}
                                        onChange={(e) => setCreateForm({...createForm, role: e.target.value})}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition-colors appearance-none"
                                    >
                                        <option value="EMPLOYEE">일반 직원</option>
                                        <option value="ADMIN">관리자</option>
                                    </select>
                                </div>
                            </div>

                            <div className="pt-4 flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setIsCreateModalOpen(false)}
                                    className="px-4 py-2 hover:bg-zinc-800 rounded-xl text-sm font-bold text-zinc-400 transition-colors"
                                >
                                    취소
                                </button>
                                <button
                                    type="submit"
                                    disabled={createLoading}
                                    className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-sm font-bold transition-colors disabled:opacity-50 flex items-center gap-2"
                                >
                                    {createLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                    추가하기
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
