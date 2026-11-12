import 'dotenv/config';
import { audit, openDatabase, transaction } from '../database.js';

const address = process.argv.slice(2).filter(value => value !== '--')[0]?.trim().toLowerCase();
if (!address) { console.error('사용법: pnpm admin -- 가입한이메일'); process.exitCode = 1; }
else {
  const db = openDatabase(process.env.DATABASE_PATH ?? './data/horubak.sqlite');
  try {
    transaction(db, () => {
      const user = db.prepare("SELECT id FROM users WHERE email=? AND status='active'").get(address) as { id: string } | undefined;
      if (!user) throw new Error('먼저 해당 이메일로 회원가입해 주세요. 활성 회원만 지정할 수 있습니다.');
      db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      audit(db, null, 'user.bootstrap-admin', user.id, '서버 운영자가 CLI로 지정');
    });
    console.log('관리자 권한을 지정했습니다. 해당 계정으로 다시 로그인해 주세요.');
  } catch (error) { console.error(error instanceof Error ? error.message : '관리자 지정 실패'); process.exitCode = 1; }
  finally { db.close(); }
}
