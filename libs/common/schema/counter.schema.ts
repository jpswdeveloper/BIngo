import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CounterDocument = HydratedDocument<Counter>;

@Schema({ collection: 'counters' })
export class Counter {
  @Prop({ required: true, unique: true })
  name!: string;

  @Prop({ required: true, default: 999 })
  seq!: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);
