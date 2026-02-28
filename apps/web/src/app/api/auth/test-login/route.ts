import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { encrypt } from "@/lib/auth";

export async function POST(request: NextRequest) {
    try {
        const testEmail = "test@3sec.test";
        
        // Check if test user already exists
        let testUser = await prisma.user.findUnique({
            where: { email: testEmail },
        });

        if (!testUser) {
            // Get or create default company
            let company = await prisma.company.findFirst();
            if (!company) {
                company = await prisma.company.create({
                    data: { name: "3sec Default Company" },
                });
            }

            // Create test user
            const passwordHash = await bcrypt.hash("test1234", 10);
            
            testUser = await prisma.user.create({
                data: {
                    email: testEmail,
                    name: "체험용 테스트 계정",
                    passwordHash,
                    role: Role.EMPLOYEE,
                    companyId: company.id,
                },
            });
        }

        // Create Session
        const session = await encrypt({ 
            userId: testUser.id, 
            role: testUser.role, 
            email: testUser.email 
        });
        
        const response = NextResponse.json({
            success: true,
            user: {
                id: testUser.id,
                email: testUser.email,
                name: testUser.name,
                role: testUser.role,
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
        console.error("Test login error:", error);
        return NextResponse.json(
            { success: false, error: "테스트 로그인 처리 중 서버 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}
