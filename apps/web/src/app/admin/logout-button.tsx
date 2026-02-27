"use client";

import axios from "axios";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

export default function LogoutButton({ className }: { className?: string }) {
    const router = useRouter();

    const handleLogout = async () => {
        try {
            await axios.post("/api/auth/logout");
            router.push("/login");
        } catch (error) {
            console.error(error);
        }
    };

    return (
        <button onClick={handleLogout} className={className}>
            <LogOut className="w-4 h-4" /> 로그아웃
        </button>
    );
}
