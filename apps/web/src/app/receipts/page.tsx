"use client";

import { useState, useEffect } from "react";
import { ArrowLeft, Edit2, Trash2, Calendar, FileText, Check, X, Search, Download, ListFilter } from "lucide-react";
import { motion } from "framer-motion";
import axios from "axios";
import Link from "next/link";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

interface Receipt {
    id: string;
    merchantName: string;
    amount: number;
    paidAt: string;
    category?: string;
    memo?: string;
    status: string;
}

export default function ReceiptsPage() {
    const [receipts, setReceipts] = useState<Receipt[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<Partial<Receipt>>({});

    // 필터 상태
    const [filters, setFilters] = useState({
        q: "",
        category: "",
        startDate: "",
        endDate: ""
    });

    const fetchReceipts = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (filters.q) params.append("q", filters.q);
            if (filters.category) params.append("category", filters.category);
            if (filters.startDate) params.append("startDate", filters.startDate);
            if (filters.endDate) params.append("endDate", filters.endDate);

            const res = await axios.get(`${API_BASE_URL}/receipts?${params.toString()}`);
            setReceipts(res.data);
        } catch (err) {
            console.error("Failed to fetch receipts:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchReceipts();
    }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleDelete = async (id: string) => {
        if (!confirm("정말 삭제하시겠습니까?")) return;
        try {
            await axios.delete(`${API_BASE_URL}/receipts/${id}`);
            setReceipts(receipts.filter(r => r.id !== id));
        } catch {
            alert("삭제 실패");
        }
    };

    const handleDownload = () => {
        const params = new URLSearchParams();
        if (filters.q) params.append("q", filters.q);
        if (filters.category) params.append("category", filters.category);
        if (filters.startDate) params.append("startDate", filters.startDate);
        if (filters.endDate) params.append("endDate", filters.endDate);

        window.open(`${API_BASE_URL}/receipts/export?${params.toString()}`, '_blank');
    };

    const startEdit = (receipt: Receipt) => {
        setEditingId(receipt.id);
        setEditForm(receipt);
    };

    const handleUpdate = async () => {
        if (!editingId) return;
        try {
            await axios.patch(`${API_BASE_URL}/receipts/${editingId}`, editForm);
            setEditingId(null);
            fetchReceipts();
        } catch {
            alert("수정 실패");
        }
    };

    return (
        <div className="min-h-screen bg-[#fafafa] text-zinc-900 font-sans p-4 md:p-8">
            <header className="max-w-4xl mx-auto mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Link href="/" className="p-2 rounded-full bg-white border border-zinc-200 hover:bg-zinc-50 transition-colors shadow-sm">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">전체 내역 관리</h1>
                        <p className="text-zinc-500 text-sm">총 {receipts.length}건의 내역</p>
                    </div>
                </div>
                <button
                    onClick={handleDownload}
                    disabled={receipts.length === 0}
                    className="flex items-center justify-center gap-2 px-5 py-2.5 bg-zinc-900 text-white rounded-2xl font-bold text-sm hover:bg-black transition-all shadow-md active:scale-95 disabled:opacity-50"
                >
                    <Download className="w-4 h-4" /> 내역 다운로드 (ZIP)
                </button>
            </header>

            <main className="max-w-4xl mx-auto space-y-6">
                {/* 필터 섹션 */}
                <section className="bg-white rounded-3xl p-6 border border-zinc-100 shadow-sm space-y-4">
                    <div className="flex items-center gap-2 mb-2 text-zinc-400">
                        <ListFilter className="w-4 h-4" />
                        <h2 className="text-xs font-black uppercase tracking-widest">Filters</h2>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="md:col-span-2 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                            <input
                                type="text"
                                placeholder="상호명 검색..."
                                value={filters.q}
                                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                                className="w-full pl-10 pr-4 py-2.5 rounded-2xl border border-zinc-100 bg-zinc-50 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none transition-all text-sm font-bold"
                            />
                        </div>
                        <div>
                            <select
                                value={filters.category}
                                onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                                className="w-full px-4 py-2.5 rounded-2xl border border-zinc-100 bg-zinc-50 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none transition-all text-sm font-bold appearance-none"
                            >
                                <option value="">모든 카테고리</option>
                                <option value="식대">식대</option>
                                <option value="접대">접대</option>
                                <option value="주유">주유</option>
                                <option value="상품구매">상품구매</option>
                                <option value="교통비">교통비</option>
                                <option value="숙박비">숙박비</option>
                                <option value="기타">기타</option>
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-zinc-400 pl-1">시작일</label>
                            <input
                                type="date"
                                value={filters.startDate}
                                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                                className="w-full px-3 py-2 rounded-xl border border-zinc-100 bg-zinc-50 text-xs font-bold focus:ring-1 focus:ring-indigo-200 outline-none"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-zinc-400 pl-1">종료일</label>
                            <input
                                type="date"
                                value={filters.endDate}
                                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                                className="w-full px-3 py-2 rounded-xl border border-zinc-100 bg-zinc-50 text-xs font-bold focus:ring-1 focus:ring-indigo-200 outline-none"
                            />
                        </div>
                        <div className="md:col-span-2 flex items-end">
                            <button
                                onClick={() => setFilters({ q: "", category: "", startDate: "", endDate: "" })}
                                className="px-4 py-2 text-zinc-400 hover:text-zinc-600 text-xs font-bold hover:underline"
                            >
                                필터 초기화
                            </button>
                        </div>
                    </div>
                </section>

                {loading ? (
                    <div className="py-20 text-center">
                        <p className="text-zinc-400 animate-pulse">상태를 불러오는 중...</p>
                    </div>
                ) : receipts.length > 0 ? (
                    <div className="space-y-4">
                        {receipts.map((r) => (
                            <motion.div
                                key={r.id}
                                layout
                                className="bg-white rounded-3xl p-5 border border-zinc-100 shadow-sm overflow-hidden group hover:border-indigo-100 transition-colors"
                            >
                                {editingId === r.id ? (
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div className="space-y-1">
                                                <label className="text-[10px] font-bold text-zinc-400 uppercase ml-1">상호명</label>
                                                <input
                                                    type="text"
                                                    value={editForm.merchantName || ""}
                                                    onChange={(e) => setEditForm({ ...editForm, merchantName: e.target.value })}
                                                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-100 outline-none text-sm font-bold"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] font-bold text-zinc-400 uppercase ml-1">금액</label>
                                                <input
                                                    type="number"
                                                    value={editForm.amount || 0}
                                                    onChange={(e) => setEditForm({ ...editForm, amount: parseInt(e.target.value) })}
                                                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 focus:ring-2 focus:ring-indigo-100 outline-none text-sm font-bold text-indigo-600"
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div className="space-y-1">
                                                <label className="text-[10px] font-bold text-zinc-400 uppercase ml-1">카테고리</label>
                                                <select
                                                    value={editForm.category || ""}
                                                    onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                                                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 text-sm font-bold focus:ring-2 focus:ring-indigo-100 outline-none"
                                                >
                                                    <option value="식대">식대</option>
                                                    <option value="접대">접대</option>
                                                    <option value="주유">주유</option>
                                                    <option value="상품구매">상품구매</option>
                                                    <option value="교통비">교통비</option>
                                                    <option value="숙박비">숙박비</option>
                                                    <option value="기타">기타</option>
                                                </select>
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[10px] font-bold text-zinc-400 uppercase ml-1">날짜</label>
                                                <input
                                                    type="date"
                                                    value={editForm.paidAt ? new Date(editForm.paidAt).toISOString().split('T')[0] : ""}
                                                    onChange={(e) => setEditForm({ ...editForm, paidAt: e.target.value })}
                                                    className="w-full px-4 py-2 rounded-xl border border-zinc-200 text-sm font-bold"
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold text-zinc-400 uppercase ml-1">메모</label>
                                            <input
                                                type="text"
                                                value={editForm.memo || ""}
                                                placeholder="메모 입력"
                                                onChange={(e) => setEditForm({ ...editForm, memo: e.target.value })}
                                                className="w-full px-4 py-2 rounded-xl border border-zinc-200 text-sm font-medium focus:ring-2 focus:ring-indigo-100 outline-none"
                                            />
                                        </div>
                                        <div className="flex gap-2 pt-2">
                                            <button onClick={handleUpdate} className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-1">
                                                <Check className="w-4 h-4" /> 저장
                                            </button>
                                            <button onClick={() => setEditingId(null)} className="flex-1 py-2.5 bg-zinc-100 text-zinc-600 rounded-xl font-bold text-sm flex items-center justify-center gap-1">
                                                <X className="w-4 h-4" /> 취소
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                        <div className="flex items-start gap-4">
                                            <div className="w-12 h-12 rounded-2xl bg-zinc-50 flex items-center justify-center text-2xl flex-shrink-0 border border-zinc-100 group-hover:bg-indigo-50 transition-colors">
                                                🧾
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <h3 className="font-bold text-zinc-900 truncate max-w-[150px]">{r.merchantName}</h3>
                                                    {r.category && (
                                                        <span className="text-[9px] bg-indigo-50 text-indigo-500 px-1.5 py-0.5 rounded-md font-black border border-indigo-100 uppercase">
                                                            {r.category}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-400">
                                                    <div className="flex items-center gap-1 font-medium">
                                                        <Calendar className="w-3 h-3" />
                                                        {new Date(r.paidAt).toLocaleDateString('ko-KR')}
                                                    </div>
                                                    {r.memo && (
                                                        <div className="flex items-center gap-1 italic opacity-80">
                                                            <FileText className="w-3 h-3" />
                                                            {r.memo}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between sm:justify-end gap-6 sm:gap-8 border-t sm:border-t-0 pt-4 sm:pt-0 border-zinc-50">
                                            <div className="text-right">
                                                <p className="text-[9px] text-zinc-400 font-black mb-0.5 uppercase tracking-tighter">Amount</p>
                                                <p className="text-lg font-black text-indigo-600">
                                                    {r.amount.toLocaleString()}원
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => startEdit(r)}
                                                    className="p-2.5 rounded-xl hover:bg-zinc-50 text-zinc-300 hover:text-indigo-600 transition-colors"
                                                >
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(r.id)}
                                                    className="p-2.5 rounded-xl hover:bg-zinc-50 text-zinc-300 hover:text-red-600 transition-colors"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        ))}
                    </div>
                ) : (
                    <div className="py-20 text-center bg-white rounded-3xl border border-dotted border-zinc-200">
                        <p className="text-zinc-400 font-medium">내역이 없습니다. 필터를 변경해 보세요.</p>
                    </div>
                )}
            </main>
        </div>
    );
}
