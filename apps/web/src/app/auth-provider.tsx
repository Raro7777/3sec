"use client";

import { useEffect, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";

export default function AuthProvider({ children }: { children: ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        const isLoggedIn = localStorage.getItem("isLoggedIn");

        // 로그인 페이지는 보호 로직에서 제외
        if (pathname === "/login") {
            if (isLoggedIn === "true") {
                router.push("/");
            } else {
                setIsReady(true);
            }
            return;
        }

        // 로그인이 안된 경우 로그인 페이지로 리다이렉트
        if (isLoggedIn !== "true") {
            router.push("/login");
        } else {
            setIsReady(true);
        }
    }, [pathname, router]);

    // 인증 체크가 완료될 때까지 빈 화면 또는 로딩 표시 (여기서는 깔끔함을 위해 null)
    if (!isReady) return <div className="min-h-screen bg-white" />;

    return <>{children}</>;
}
