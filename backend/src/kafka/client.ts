import { Kafka, logLevel, Partitioners } from 'kafkajs';
import { config } from '../config.ts';
import { registerSnappy } from './snappy.ts';

registerSnappy();

export const kafka = new Kafka({
  clientId: 'kitlisto-inventory',
  brokers: config.kafkaBrokers,
  logLevel: logLevel.WARN,
  retry: { initialRetryTime: 300, retries: 10 },
});

export const CATALOG_TOPIC = 'shop.catalog';
export const SHOP_TOPICS = ['shop.work_orders', 'shop.inspections', 'shop.purchasing'];
export const INPUT_TOPICS = [CATALOG_TOPIC, ...SHOP_TOPICS];

// Particionador por defecto explícito (evita la advertencia de kafkajs 2).
export const producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner,
  allowAutoTopicCreation: false,
});

export const admin = kafka.admin();

/** Marca final (high watermark) por partición de cada tópico, en este momento. */
export async function fetchHighWatermarks(topics: string[]): Promise<Map<string, Map<number, number>>> {
  const result = new Map<string, Map<number, number>>();
  for (const topic of topics) {
    const offsets = await admin.fetchTopicOffsets(topic);
    result.set(topic, new Map(offsets.map((o: any) => [o.partition, Number(o.high)])));
  }
  return result;
}
