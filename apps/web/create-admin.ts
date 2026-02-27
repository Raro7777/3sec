import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    let company = await prisma.company.findFirst();
    if (!company) {
        company = await prisma.company.create({ data: { name: '3sec Default Company' }});
    }

    const passwordHash = await bcrypt.hash('447522', 10);

    const user = await prisma.user.upsert({
        where: { email: 'admin' },
        update: {
            passwordHash,
            role: 'ADMIN',
        },
        create: {
            email: 'admin',
            name: 'Master Admin',
            passwordHash,
            role: 'ADMIN',
            companyId: company.id,
        }
    });

    console.log('Successfully created/updated admin account:');
    console.log('ID:', user.email);
    console.log('Role:', user.role);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
