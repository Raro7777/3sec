import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { encrypt } from "@/lib/auth";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { email, password, name } = body;

        if (!email || !password || !name) {
            return NextResponse.json(
                { success: false, error: "모든 필드를 입력해주세요." },
                { status: 400 }
            );
        }

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            return NextResponse.json(
                { success: false, error: "이미 가입된 이메일입니다." },
                { status: 400 }
            );
        }

        // Get default company
        let company = await prisma.company.findFirst();
        if (!company) {
            company = await prisma.company.create({
                data: { name: "3sec Default Company" },
            });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Create user
        const newUser = await prisma.user.create({
            data: {
                email,
                name,
                passwordHash,
                role: Role.EMPLOYEE, // Default role
                companyId: company.id,
            },
        });

        // Automatically log them in (Create Session)
        const session = await encrypt({ userId: newUser.id, role: newUser.role, email: newUser.email });
        
        const response = NextResponse.json({
            success: true,
            user: {
                id: newUser.id,
                email: newUser.email,
                name: newUser.name,
                role: newUser.role,
            },
        });

        response.cookies.set("auth_token", session, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 60 * 60 * 24 * 7, // 1 week
        });

        return response;
        
    } catch (error) {
        console.error("Registration error:", error);
        return NextResponse.json(
            { success: false, error: "회원가입 처리 중 서버 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}
