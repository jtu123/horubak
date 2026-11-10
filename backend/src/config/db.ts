import mysql from 'mysql2/promise';

// 데이터베이스 연결 풀 생성
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '20213002',      // 방금 설정한 비밀번호
  database: 'users',    // 사용하실 데이터베이스 이름 (예: 캡스톤 프로젝트용 DB 이름)
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

export default pool;