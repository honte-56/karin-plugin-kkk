import fs from 'node:fs'
import path from 'node:path'

import { logger } from 'node-karin'
import { karinPathBase } from 'node-karin/root'
import sqlite3, { sqlite3 as sqlite3Types } from 'node-karin/sqlite3'

import { Root } from '../../root'

export type ContentDeliverySource = 'parse' | 'push'

export interface ContentDeliveryRecord {
  scope: string
  contentKey: string
  source: ContentDeliverySource
  deliveredAt: string
}

export class ContentDeliveryDBBase {
  private db!: sqlite3Types['Database']
  private readonly dbPath: string

  constructor(dbPath = path.join(`${karinPathBase}/${Root.pluginName}/data`, 'delivery-history.db')) {
    this.dbPath = dbPath
  }

  async init(): Promise<ContentDeliveryDBBase> {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true })
    this.db = new sqlite3.Database(this.dbPath)
    await this.runQuery(`CREATE TABLE IF NOT EXISTS ContentDeliveries (
      scope TEXT NOT NULL,
      contentKey TEXT NOT NULL,
      source TEXT NOT NULL,
      deliveredAt TEXT NOT NULL,
      PRIMARY KEY (scope, contentKey)
    )`)
    await this.runQuery('CREATE INDEX IF NOT EXISTS idx_content_deliveries_time ON ContentDeliveries(deliveredAt)')
    return this
  }

  async findRecent(
    scope: string,
    contentKeys: string[],
    windowMinutes: number,
    now = new Date()
  ): Promise<ContentDeliveryRecord | undefined> {
    if (contentKeys.length === 0 || windowMinutes <= 0) return undefined

    const placeholders = contentKeys.map(() => '?').join(', ')
    const cutoff = new Date(now.getTime() - windowMinutes * 60_000).toISOString()
    return await this.getQuery<ContentDeliveryRecord>(
      `SELECT scope, contentKey, source, deliveredAt
       FROM ContentDeliveries
       WHERE scope = ? AND contentKey IN (${placeholders}) AND deliveredAt > ?
       ORDER BY deliveredAt DESC
       LIMIT 1`,
      [scope, ...contentKeys, cutoff]
    )
  }

  async record(scope: string, contentKeys: string[], source: ContentDeliverySource, deliveredAt = new Date()): Promise<void> {
    const keys = [...new Set(contentKeys)]
    if (keys.length === 0) return

    const timestamp = deliveredAt.toISOString()
    await this.runQuery('BEGIN TRANSACTION')
    try {
      for (const contentKey of keys) {
        await this.runQuery(
          `INSERT INTO ContentDeliveries (scope, contentKey, source, deliveredAt)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(scope, contentKey) DO UPDATE SET source = excluded.source, deliveredAt = excluded.deliveredAt`,
          [scope, contentKey, source, timestamp]
        )
      }
      await this.runQuery('COMMIT')
    } catch (error) {
      await this.runQuery('ROLLBACK')
      throw error
    }
  }

  async cleanOlderThan(hours: number, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - hours * 60 * 60_000).toISOString()
    const result = await this.runQuery('DELETE FROM ContentDeliveries WHERE deliveredAt <= ?', [cutoff])
    return result.changes ?? 0
  }

  async close(): Promise<void> {
    if (!this.db) return
    await new Promise<void>((resolve, reject) => {
      this.db.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  private runQuery(sql: string, params: unknown[] = []): Promise<{ lastID: number; changes: number }> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (error) {
        if (error) {
          logger.debug(`[ContentDeliveryDB] SQL 执行失败: ${error.message}`)
          reject(error)
        } else {
          resolve({ lastID: this.lastID, changes: this.changes })
        }
      })
    })
  }

  private getQuery<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (error, row) => {
        if (error) reject(error)
        else resolve(row as T | undefined)
      })
    })
  }
}
