import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    let company = await prisma.company.findFirst();
    if (!company) {
        company = await prisma.company.create({ data: { name: '3sec Default Company' }});
    }

    const passwordHash = await bcrypt.hash('1234', 10);

    const testUsers = [
        { email: 'test1', name: '테스트 유저 1', role: 'USER' },
        { email: 'test2', name: '테스트 유저 2', role: 'USER' },
        { email: 'test3', name: '테스트 유저 3', role: 'USER' }
    ];

    for (const testUser of testUsers) {
        const user = await prisma.user.upsert({
            where: { email: testUser.email },
            update: {
                passwordHash,
                role: testUser.role as any,
                name: testUser.name
            },
            create: {
                email: testUser.email,
                name: testUser.name,
                passwordHash,
                role: testUser.role as any,
                companyId: company.id,
            }
        });
        console.log(`Successfully upserted: ${user.email} (${user.name})`);
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
