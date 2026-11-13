import 'dotenv/config';
import { audit } from '../database-contract.js';
import { openDatabase } from '../database.js';

const [flag, accountId, ...extra] = process.argv.slice(2).filter(value => value !== '--');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (flag !== '--verified-account' || !accountId || !uuid.test(accountId) || extra.length) {
  console.error('사용법: pnpm admin -- --verified-account <소유자를 확인한 계정 ID>');
  process.exitCode = 1;
}
else {
  const db = openDatabase(process.env.DATABASE_PATH ?? './data/horubak.sqlite');
  try {
    db.transaction(() => {
      const user = db.prepare("SELECT id FROM users WHERE id=? AND status='active'").get(accountId.toLowerCase()) as { id: string } | undefined;
      if (!user) throw new Error('확인한 계정 ID와 일치하는 활성 회원이 없습니다.');
      db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      audit(db, null, 'user.bootstrap-admin', user.id, '서버 운영자가 CLI로 지정');
    });
    console.log('관리자 권한을 지정했습니다. 해당 계정으로 다시 로그인해 주세요.');
  } catch (error) { console.error(error instanceof Error ? error.message : '관리자 지정 실패'); process.exitCode = 1; }
  finally { db.close(); }
}
