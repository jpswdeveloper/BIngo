import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { Counter, CounterSchema } from 'libs/common/schema/counter.schema';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],

  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Counter.name, schema: CounterSchema },
    ]),
  ],
})
export class UsersModule {}
